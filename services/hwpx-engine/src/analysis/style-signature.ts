import { canonicalJson } from '@une/domain';
import type { HeaderIndex } from '../ir/header-index';
import type { ParagraphSource } from '../ir/ir-builder';
import { stableId } from '../ir/stable-id';
import { extractPrefix, paragraphText } from './outline-pattern';

/**
 * Style Signature (설계 07 §1.5-1).
 *
 * "Signature는 ParaShape/CharShape **ID뿐 아니라 실제 속성값**과 prefix·
 * 들여쓰기·문단 간격을 포함한다." ID만 쓰면 같은 모양인데 ID가 다른 문단이
 * 다른 군집으로 갈리고(양식 편집 이력 때문에 흔하다), 반대로 ID가 같아도
 * 실제 속성이 다른 경우를 놓친다.
 */

export interface StyleSignatureFeatures {
  readonly paraPrId: number | null;
  readonly charPrId: number | null;
  readonly styleId: number | null;
  readonly align: string | null;
  readonly marginLeft: number;
  readonly marginRight: number;
  readonly marginIntent: number;
  readonly spacingPrev: number;
  readonly spacingNext: number;
  readonly lineSpacingType: string | null;
  readonly lineSpacingValue: number | null;
  readonly headingType: string | null;
  readonly headingLevel: number | null;
  readonly charHeight: number | null;
  readonly bold: boolean;
  readonly textColor: string | null;
  readonly fontRefHangul: string | null;
  /** 기호 자체. 뒤따르는 본문 텍스트는 절대 넣지 않는다(security.md). */
  readonly literalPrefix: string | null;
  readonly leadingWhitespace: string | null;
  readonly inTable: boolean;
  readonly inControl: boolean;
}

export interface StyleSignature {
  readonly signatureId: string;
  readonly features: StyleSignatureFeatures;
}

export interface StyleCluster {
  readonly signatureId: string;
  readonly features: StyleSignatureFeatures;
  readonly paragraphIds: readonly string[];
  readonly count: number;
  readonly firstDocumentOrder: number;
}

export function signatureOf(source: ParagraphSource, headerIndex: HeaderIndex): StyleSignature {
  const { paraPrId, charPrId, styleId } = source.paragraph.styleRef;
  const paraDetail = paraPrId === null ? undefined : headerIndex.paraPr.get(paraPrId);
  const charDetail =
    source.firstCharPrId === null ? undefined : headerIndex.charPr.get(source.firstCharPrId);
  const prefix = extractPrefix(paragraphText(source));

  const features: StyleSignatureFeatures = {
    paraPrId,
    charPrId,
    styleId,
    align: paraDetail?.align ?? null,
    marginLeft: paraDetail?.marginLeft ?? 0,
    marginRight: paraDetail?.marginRight ?? 0,
    marginIntent: paraDetail?.marginIntent ?? 0,
    spacingPrev: paraDetail?.spacingPrev ?? 0,
    spacingNext: paraDetail?.spacingNext ?? 0,
    lineSpacingType: paraDetail?.lineSpacingType ?? null,
    lineSpacingValue: paraDetail?.lineSpacingValue ?? null,
    headingType: paraDetail?.headingType ?? null,
    headingLevel: paraDetail?.headingLevel ?? null,
    charHeight: charDetail?.height ?? null,
    bold: charDetail?.bold ?? false,
    textColor: charDetail?.textColor ?? null,
    fontRefHangul: charDetail?.fontRefHangul ?? null,
    literalPrefix: prefix?.literalPrefix ?? null,
    leadingWhitespace: prefix?.leadingWhitespace ?? null,
    inTable: source.tableContext !== null,
    inControl: source.inControl,
  };

  return { signatureId: stableId('REG', canonicalJson(features)), features };
}

/** §1.5-3 동일 Signature 군집화 + 문서 내 반복빈도. */
export function clusterSignatures(
  paragraphs: readonly ParagraphSource[],
  headerIndex: HeaderIndex,
): { clusters: readonly StyleCluster[]; byParagraphId: ReadonlyMap<string, string> } {
  const clusters = new Map<
    string,
    {
      features: StyleSignatureFeatures;
      paragraphIds: string[];
      firstDocumentOrder: number;
    }
  >();
  const byParagraphId = new Map<string, string>();

  for (const source of paragraphs) {
    const signature = signatureOf(source, headerIndex);
    byParagraphId.set(source.paragraph.paragraphId, signature.signatureId);
    const existing = clusters.get(signature.signatureId);
    if (existing) {
      existing.paragraphIds.push(source.paragraph.paragraphId);
    } else {
      clusters.set(signature.signatureId, {
        features: signature.features,
        paragraphIds: [source.paragraph.paragraphId],
        firstDocumentOrder: source.documentOrder,
      });
    }
  }

  const result: StyleCluster[] = [...clusters.entries()]
    .map(([signatureId, value]) => ({
      signatureId,
      features: value.features,
      paragraphIds: value.paragraphIds,
      count: value.paragraphIds.length,
      firstDocumentOrder: value.firstDocumentOrder,
    }))
    .sort((a, b) => a.firstDocumentOrder - b.firstDocumentOrder);

  return { clusters: result, byParagraphId };
}
