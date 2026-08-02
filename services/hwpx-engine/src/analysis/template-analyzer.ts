import type { ConfidenceComponents, DocumentCompatibilityVerdict, HwpxFinding } from '@une/domain';
import { classify, type ClassificationResult } from '../compat/classifier';
import { anchorOf, sourceAnchor } from '../ir/anchors';
import type { DocumentIrBuildResult, ParagraphSource } from '../ir/ir-builder';
import type { PackageAnalysisResult } from '../package/package-analysis';
import { computeConfidenceEvidence, type ConfidenceEvidence } from './confidence';
import {
  analyzeOutlinePatterns,
  extractPrefix,
  paragraphText,
  type OutlineAnalysis,
} from './outline-pattern';
import { buildPrototypes, type Prototype } from './prototype-registry';
import { detectStaticRegions, type StaticRegion } from './static-region';
import { clusterSignatures, type StyleCluster } from './style-signature';

/**
 * TemplateAnalyzer (설계 07 §1.5). 6단계를 순서대로 조립한다.
 *
 * 1) Style Signature 생성 → `style-signature.ts`
 * 2) 규칙 기반 1차 역할 분류 → `assignRoles` (이 파일)
 * 3) 군집화·반복빈도·계층·위치 → `style-signature.ts` + `outline-pattern.ts`
 * 4) confidence 산출 → `confidence.ts` (가중치는 도메인)
 * 5) AUTO/CONFIRM/LIMITED/REJECT 판정 → 도메인 `rollUpVerdict` 호출
 * 6) 역할별 Prototype 등록 → `prototype-registry.ts`
 */

export interface RoleAssignment {
  readonly paragraphId: string;
  readonly styleRole: string;
  readonly outlineLevel: number | null;
  readonly evidence: string;
}

export interface TemplateAnalysisResult {
  readonly compatibility: {
    readonly verdict: DocumentCompatibilityVerdict;
    readonly confidence: number;
    readonly components: ConfidenceComponents;
    readonly confidenceBasis: ConfidenceEvidence['basis'];
    readonly objectCounts: ClassificationResult['counts'];
    readonly classification: ClassificationResult;
  };
  readonly roles: readonly RoleAssignment[];
  readonly outlinePatterns: OutlineAnalysis['patterns'];
  readonly prototypes: readonly Prototype[];
  readonly staticRegions: readonly StaticRegion[];
  readonly styleClusters: readonly StyleCluster[];
  readonly warnings: readonly string[];
  readonly findings: readonly HwpxFinding[];
}

/**
 * §1.5-2 규칙 기반 1차 분류. 순서가 곧 우선순위다.
 *   EMPTY < TABLE_CELL < HEADER_FOOTER < OUTLINE_n < TITLE < BODY
 */
function assignRoles(
  paragraphs: readonly ParagraphSource[],
  outline: OutlineAnalysis,
  staticRegions: readonly StaticRegion[],
): RoleAssignment[] {
  const outlineByParagraph = new Map(
    outline.assignments.map((assignment) => [assignment.paragraphId, assignment] as const),
  );
  const coverAnchors = new Set(
    staticRegions
      .filter((regionItem) => regionItem.kind === 'COVER_TITLE')
      .map((regionItem) => regionItem.locator),
  );

  const roles: RoleAssignment[] = [];
  for (const source of paragraphs) {
    const text = paragraphText(source);
    const paragraphId = source.paragraph.paragraphId;
    if (text.trim().length === 0) {
      roles.push({
        paragraphId,
        styleRole: 'EMPTY',
        outlineLevel: null,
        evidence: 'textLength=0',
      });
      continue;
    }
    if (source.inControl) {
      roles.push({
        paragraphId,
        styleRole: 'HEADER_FOOTER',
        outlineLevel: null,
        evidence: 'paragraph is inside a preserved control subtree',
      });
      continue;
    }
    const assignment = outlineByParagraph.get(paragraphId);
    if (assignment) {
      roles.push({
        paragraphId,
        styleRole: `OUTLINE_${assignment.outlineLevel}`,
        outlineLevel: assignment.outlineLevel,
        evidence: `outlinePattern=${assignment.patternId}`,
      });
      continue;
    }
    if (source.tableContext !== null) {
      roles.push({
        paragraphId,
        styleRole: 'TABLE_CELL',
        outlineLevel: null,
        evidence: `tableContext=${source.tableContext}`,
      });
      continue;
    }
    if (coverAnchors.has(sourceAnchor(source.paragraph, paragraphId))) {
      roles.push({
        paragraphId,
        styleRole: 'TITLE',
        outlineLevel: null,
        evidence: 'static region COVER_TITLE',
      });
      continue;
    }
    roles.push({
      paragraphId,
      styleRole: 'BODY',
      outlineLevel: null,
      evidence: `documentOrder=${source.documentOrder} textLength=${text.length}`,
    });
  }
  return roles;
}

export function analyzeTemplate(
  analysis: PackageAnalysisResult,
  build: DocumentIrBuildResult,
): TemplateAnalysisResult {
  const sectionRoots = new Map(
    [...analysis.parsedParts].filter(([, root]) => root.localName === 'sec'),
  );

  const { clusters } = clusterSignatures(build.paragraphs, build.headerIndex);
  const outline = analyzeOutlinePatterns(build.paragraphs, build.headerIndex);
  const staticRegions = detectStaticRegions({
    sectionRoots,
    paragraphs: build.paragraphs,
    tables: build.tables,
    headerIndex: build.headerIndex,
    anchorOf,
  });
  const roles = assignRoles(build.paragraphs, outline, staticRegions);
  const confidence = computeConfidenceEvidence({
    paragraphs: build.paragraphs,
    clusters,
    outline,
    staticRegions,
  });

  const roleByParagraph = new Map(
    roles
      .filter((role) => role.styleRole !== 'EMPTY')
      .map(
        (role) =>
          [
            role.paragraphId,
            { styleRole: role.styleRole, outlineLevel: role.outlineLevel },
          ] as const,
      ),
  );
  const prefixedParagraphs = new Set(
    build.paragraphs
      .filter((source) => extractPrefix(paragraphText(source)) !== null)
      .map((source) => source.paragraph.paragraphId),
  );
  const prototypes = buildPrototypes({
    roles: roleByParagraph,
    paragraphs: build.paragraphs,
    tables: build.tables,
    hasLiteralPrefix: (paragraphId) => prefixedParagraphs.has(paragraphId),
  });

  const classification = classify({
    analysis,
    confidence: confidence.value,
    extraFindings: build.findings,
  });

  const warnings = [...outline.warnings];
  if (build.paragraphs.length === 0) warnings.push('문단이 하나도 없습니다');
  if (prototypes.length === 0) warnings.push('등록된 Prototype이 없습니다');
  for (const item of classification.findings) {
    if (item.severity !== 'INFO') warnings.push(`${item.code} ${item.locator}: ${item.detail}`);
  }

  return {
    compatibility: {
      verdict: classification.verdict,
      confidence: confidence.value,
      components: confidence.components,
      confidenceBasis: confidence.basis,
      objectCounts: classification.counts,
      classification,
    },
    roles,
    outlinePatterns: outline.patterns,
    prototypes,
    staticRegions,
    styleClusters: clusters,
    warnings,
    findings: classification.findings,
  };
}
