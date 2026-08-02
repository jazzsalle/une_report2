import type { DocumentIR, TemplateProfile } from '@une/domain';
import type { Prototype } from '../analysis/prototype-registry';
import { HwpxEngine } from '../contract';
import type { PackageAnalysisResult } from '../package/package-analysis';
import { synthHwpx, type SynthFixtureId } from '../testing/synth-hwpx';
import { indexDocument, type DocumentIndex } from './document-tree';
import { liftV1 } from './ir-lift';

/**
 * 편집층 테스트 픽스처 (CC-150). **운영 경로에서 호출하지 않는다.**
 *
 * 보안: 입력은 전부 합성 HWPX다(`testing/synth-hwpx`). 실 코퍼스 6종
 * (`templete/`)은 실제 업무 양식이므로 본문을 단언값·증거로 남기지 않는다 —
 * 실 코퍼스는 `inverse-ops.test.ts`에서 **구조와 해시**로만 쓴다.
 */

export interface EditFixture {
  readonly ir: DocumentIR;
  readonly index: DocumentIndex;
  readonly prototypes: readonly Prototype[];
  readonly profile: TemplateProfile;
  readonly staticRegionAnchors: readonly string[];
  readonly analysis: PackageAnalysisResult;
  readonly revisionId: string;
}

const engine = new HwpxEngine();

export function editFixture(fixture: SynthFixtureId = 'valid'): EditFixture {
  const result = engine.analyzeDocument({ bytes: synthHwpx(fixture) });
  const ir = liftV1(result.ir);
  return {
    ir,
    index: indexDocument(ir),
    prototypes: result.template.prototypes,
    profile: result.profile,
    staticRegionAnchors: result.profile.staticRegions.map((region) => region.locator),
    analysis: result.package,
    revisionId: 'rev-1',
  };
}

/** 본문 최상위 문단 ID를 문서 순서로. */
export function topLevelParagraphIds(ir: DocumentIR): string[] {
  return ir.sections[0].blocks
    .filter((block) => block.kind === 'PARAGRAPH')
    .map((block) => (block.kind === 'PARAGRAPH' ? block.paragraphId : ''));
}

export function paragraphTextById(ir: DocumentIR, id: string): string {
  const entry = indexDocument(ir).blocks.get(id);
  if (!entry || entry.block.kind !== 'PARAGRAPH') return '';
  return entry.block.runs.map((run) => run.text).join('');
}
