import { describe, expect, it } from 'vitest';
import { HwpxEngine } from './contract';
import { HwpxImportError } from './package/errors';
import {
  CORPUS_DECLARED_SYNTH_FIXTURE_IDS,
  SYNTH_FIXTURE_IDS,
  synthHwpx,
  type SynthFixtureId,
} from './testing/synth-hwpx';

/**
 * 합성 픽스처 9종 (ADR-29 D8: 음성·희소 케이스 전용).
 *
 * 실 코퍼스로는 얻을 수 없는 것들이다 — 악성 ZIP을 저장소에 커밋할 수 없고,
 * 수식/OLE가 든 재난 보고 양식이 코퍼스에 없다. 픽스처는 디스크에 남지 않고
 * `synth-hwpx.ts`가 메모리에서 결정적으로 조립한다.
 */

const engine = new HwpxEngine();

function captureError(fixture: SynthFixtureId): HwpxImportError {
  try {
    engine.analyzeDocument({ bytes: synthHwpx(fixture) });
  } catch (error) {
    if (error instanceof HwpxImportError) return error;
    throw error;
  }
  throw new Error(`${fixture}가 거부되지 않았습니다`);
}

describe('합성 픽스처 — 업로드 거부 계열', () => {
  it('HWPX-1001 zip-signature-broken', () => {
    const error = captureError('zip-signature-broken');
    expect(error.code).toBe('HWPX-1001');
    expect(error.locator).toBe('(archive)');
  });

  it('HWPX-1001 path-traversal', () => {
    const error = captureError('path-traversal');
    expect(error.code).toBe('HWPX-1001');
    expect(error.locator).toBe('../evil.xml');
  });

  it('HWPX-1001 duplicate-entry', () => {
    const error = captureError('duplicate-entry');
    expect(error.code).toBe('HWPX-1001');
    expect(error.detail).toMatch(/중복/);
  });

  it('HWPX-1001 doctype-xxe — 본문 Part의 DTD를 바이트 스캔으로 잡는다', () => {
    const error = captureError('doctype-xxe');
    expect(error.code).toBe('HWPX-1001');
    expect(error.locator).toBe('Contents/section0.xml');
    expect(error.detail).toMatch(/DOCTYPE/);
  });

  it('HWPX-1002 zip-bomb — 압축해제 전에 중앙디렉터리 값으로 거부한다', () => {
    const error = captureError('zip-bomb');
    expect(error.code).toBe('HWPX-1002');
    expect(error.locator).toBe('BinData/bomb.bin');
  });

  /**
   * ZIP 층 방어의 **음성 재현** (리뷰 m-9).
   *
   * zip-reader에는 심볼릭 링크·암호화·data descriptor·ZIP64를 거부하는 코드가
   * 있었지만 그것을 밟는 픽스처가 없었다. 방어 코드에 테스트가 없으면
   * 리팩터링 한 번에 조용히 사라지고, 사라진 사실도 드러나지 않는다.
   */
  it('HWPX-1001 symlink-entry — 심볼릭 링크 엔트리 거부', () => {
    const error = captureError('symlink-entry');
    expect(error.code).toBe('HWPX-1001');
    expect(error.locator).toBe('BinData/link.bin');
    expect(error.detail).toMatch(/심볼릭 링크/);
  });

  it('HWPX-1001 encrypted-entry — 암호화 플래그(0x01) 거부', () => {
    const error = captureError('encrypted-entry');
    expect(error.code).toBe('HWPX-1001');
    expect(error.locator).toBe('BinData/secret.bin');
    expect(error.detail).toMatch(/암호화/);
  });

  it('HWPX-1001 data-descriptor — flag 0x08 거부(중앙디렉터리 값만 신뢰)', () => {
    const error = captureError('data-descriptor');
    expect(error.code).toBe('HWPX-1001');
    expect(error.detail).toMatch(/data descriptor/);
  });

  it('HWPX-1001 zip64-locator — ZIP64 EOCD locator 거부', () => {
    const error = captureError('zip64-locator');
    expect(error.code).toBe('HWPX-1001');
    expect(error.locator).toBe('(archive)');
    expect(error.detail).toMatch(/ZIP64 EOCD locator/);
  });

  it('HWPX-1001 zip64-entry-count — EOCD 엔트리 수 0xFFFF sentinel 거부', () => {
    const error = captureError('zip64-entry-count');
    expect(error.code).toBe('HWPX-1001');
    expect(error.detail).toMatch(/ZIP64 아카이브는 지원하지 않습니다/);
  });

  it('HWPX-1002 deep-xml-nesting — XML 깊이 한도를 파싱 중에 거부한다', () => {
    // 한도가 없으면 이후의 재귀 순회가 RangeError로 죽고, 그것은
    // HwpxImportError가 아니라 호출자가 다룰 수 없는 형태다(리뷰 m-2).
    const error = captureError('deep-xml-nesting');
    expect(error.code).toBe('HWPX-1002');
    expect(error.locator).toBe('Contents/section0.xml');
    expect(error.detail).toMatch(/중첩 깊이 한도 초과/);
  });
});

describe('합성 픽스처 — 열되 판정하는 계열', () => {
  it('HWPX-1003 missing-header → 문서 REJECT', () => {
    const result = engine.analyzeDocument({ bytes: synthHwpx('missing-header') });
    expect(result.package.requiredParts.missing).toEqual(['Contents/header.xml']);
    expect(
      result.template.findings.some(
        (finding) => finding.code === 'HWPX-1003' && finding.severity === 'FATAL',
      ),
    ).toBe(true);
    expect(result.template.compatibility.verdict).toBe('REJECT');
    // 필수 Part 누락은 REJECT 객체로도 표현된다(§8.4 마지막 행).
    expect(result.template.compatibility.objectCounts.REJECT).toBeGreaterThan(0);
  });

  it('HWPX-1005 dangling-parapr → 문서 REJECT + I3 위반', () => {
    const result = engine.analyzeDocument({ bytes: synthHwpx('dangling-parapr') });
    const dangling = result.template.findings.filter((finding) => finding.code === 'HWPX-1005');
    expect(dangling.length).toBeGreaterThan(0);
    expect(dangling[0].detail).toMatch(/paraPrIDRef=999/);
    expect(result.template.compatibility.verdict).toBe('REJECT');
    expect(result.invariants?.ok).toBe(false);
    expect(result.invariants?.violations.some((item) => item.invariant === 'I3')).toBe(true);
  });

  it('HWPX-1004 flatten-only-object → FLATTEN_EXPORT_ONLY 1건, 판정 LIMITED', () => {
    const result = engine.analyzeDocument({ bytes: synthHwpx('flatten-only-object') });
    expect(result.template.compatibility.objectCounts.FLATTEN_EXPORT_ONLY).toBe(1);
    const equation = result.template.compatibility.classification.objects.find(
      (object) => object.classification.reasonCode === 'OBJ-EQUATION',
    );
    expect(equation?.classification.objectClass).toBe('FLATTEN_EXPORT_ONLY');
    expect(equation?.classification.evidence).toMatch(/hp:equation/);
    expect(result.template.compatibility.verdict).toBe('LIMITED');
    expect(result.template.findings.some((finding) => finding.code === 'HWPX-1004')).toBe(true);
    // 원본은 삭제·변형되지 않고 PRESERVED 블록으로 자리를 지킨다.
    const preserved = result.ir.sections[0].blocks.filter((block) => block.kind === 'PRESERVED');
    expect(
      preserved.some((block) =>
        block.kind === 'PRESERVED' ? block.classification.reasonCode === 'OBJ-EQUATION' : false,
      ),
    ).toBe(true);
    expect(result.invariants?.ok).toBe(true);
  });

  it('multi-section → section0/section1이 순서대로 IR에 들어간다', () => {
    const result = engine.analyzeDocument({ bytes: synthHwpx('multi-section') });
    expect(result.package.sectionParts).toEqual(['Contents/section0.xml', 'Contents/section1.xml']);
    expect(result.ir.sections.map((section) => section.partPath)).toEqual([
      'Contents/section0.xml',
      'Contents/section1.xml',
    ]);
    expect(new Set(result.ir.sections.map((section) => section.sectionId)).size).toBe(2);
    expect(result.invariants?.ok).toBe(true);
    expect(result.invariants?.violations).toEqual([]);
  });

  it('valid — 기준 픽스처는 불변식을 모두 만족한다', () => {
    const result = engine.analyzeDocument({ bytes: synthHwpx('valid') });
    expect(result.invariants?.ok).toBe(true);
    expect(result.package.requiredParts.missing).toEqual([]);
    expect(result.package.unmanifestedParts.length).toBeGreaterThan(0);
    // hp:pageNum(자동 쪽번호)이 있어 상한이 걸린다.
    expect(result.template.compatibility.verdict).toBe('LIMITED');
  });

  it('HWPX-1005 dangling-styleref → DEGRADING이지 REJECT가 아니다 (§1.4 "CONFIRM 또는 REJECT")', () => {
    // 리뷰 m-1: 이전에는 HWPX-1005가 무조건 FATAL→REJECT였다. hh:style은
    // paraPr/charPr 기본값 묶음일 뿐이고 hp:p가 자기 ID를 명시하므로,
    // 없어도 렌더·편집이 성립한다 → 복구 가능(DEGRADING).
    const result = engine.analyzeDocument({ bytes: synthHwpx('dangling-styleref') });
    const dangling = result.template.findings.filter((item) => item.code === 'HWPX-1005');
    expect(dangling).toHaveLength(1);
    expect(dangling[0].severity).toBe('DEGRADING');
    expect(dangling[0].detail).toMatch(/styleIDRef=777/);
    expect(result.template.compatibility.verdict).not.toBe('REJECT');
    expect(result.template.compatibility.objectCounts.REJECT).toBe(0);
    // 불변식은 별개 층이다 — 참조가 색인에 없다는 사실 자체는 I3 위반이다.
    expect(result.invariants?.violations.some((item) => item.invariant === 'I3')).toBe(true);
  });

  it('empty-table-cell — 문단 없는 셀의 현재 동작을 값으로 고정한다', () => {
    // 리뷰 G-2: CC-150이 저장 경로를 열 때 런타임에서 처음 만나면 안 된다.
    // 빈 문단을 몰래 채워 넣지 않는다 — 그러면 원본에 없던 문단이 생겨
    // 무손실이 깨진다. 대신 신고하고, 불변식이 위반으로 잡는다.
    const result = engine.analyzeDocument({ bytes: synthHwpx('empty-table-cell') });
    const emptyCell = result.template.findings.filter(
      (item) => item.code === 'HWPX-1005' && item.detail.includes('표 셀에 문단이'),
    );
    expect(emptyCell).toHaveLength(1);
    expect(emptyCell[0].severity).toBe('DEGRADING');
    expect(result.invariants?.ok).toBe(false);
    expect(
      result.invariants?.violations.filter(
        (item) => item.invariant === 'I6' && item.detail === '셀에 문단이 없습니다',
      ),
    ).toHaveLength(1);
    // 계약 스키마(`document-ir.schema.json`)의 blocks `minItems: 1`도 위반한다.
    // 그 사실을 IR 값으로도 남긴다 — 스키마 검증은 tests/contract 소유다.
    const emptyBlocks = [...result.ir.sections[0].blocks]
      .filter((block) => block.kind === 'TABLE')
      .flatMap((block) => (block.kind === 'TABLE' ? block.rows : []))
      .flatMap((row) => row.cells)
      .filter((cell) => cell.blocks.length === 0);
    expect(emptyBlocks).toHaveLength(1);
  });
});

/**
 * AUTO 밴드 도달 가능성 증명 (G15-1 "AUTO/CONFIRM/LIMITED 판정과 분석근거가
 * 재현된다").
 *
 * 실 코퍼스 6종은 전부 머리말·자동 쪽번호·필드·그림 중 하나를 갖고 있어
 * 정당하게 LIMITED다. 그래서 "AUTO 경로가 코드에 존재하기는 하는가"를 실문서로
 * 보일 수 없다. `multi-section`과 `no-restricted-object`는 **본문이 동일하고
 * hp:pageNum 유무만 다른 A/B 쌍**이라, 상한이 유일한 차이임을 값으로 보인다.
 */
describe('상한 유발 객체가 없으면 confidence 밴드가 살아난다', () => {
  const withPageNumber = engine.analyzeDocument({ bytes: synthHwpx('multi-section') });
  const withoutPageNumber = engine.analyzeDocument({ bytes: synthHwpx('no-restricted-object') });

  it('두 문서의 confidence는 같다 (본문이 같으므로)', () => {
    expect(withoutPageNumber.template.compatibility.confidence).toBe(
      withPageNumber.template.compatibility.confidence,
    );
    // 실측 0.9063 — AUTO 임계 0.85 위.
    expect(withoutPageNumber.template.compatibility.confidence).toBe(0.9063);
  });

  it('hp:pageNum이 있으면 LIMITED, 없으면 AUTO', () => {
    expect(withPageNumber.template.compatibility.verdict).toBe('LIMITED');
    expect(withoutPageNumber.template.compatibility.verdict).toBe('AUTO');
  });

  it('AUTO 문서에도 PART 층 PRESERVE_ONLY와 레이아웃·공백 객체는 그대로 있다', () => {
    const objects = withoutPageNumber.template.compatibility.classification.objects;
    // PART 층 보존 대상(Preview/PrvText, container.rdf, settings.xml)은 존재한다.
    expect(
      objects.filter(
        (object) =>
          object.scope === 'PART' && object.classification.objectClass === 'PRESERVE_ONLY',
      ).length,
    ).toBeGreaterThan(0);
    // 단 속성·고정폭 빈칸·줄바꿈은 **PRESERVE_ONLY이되 상한을 유발하지 않는다**
    // (리뷰 M-3: 등급 축과 상한 축의 분리). 등급을 NATIVE_EDIT로 되돌리면
    // IR이 파싱하지 않는 XML에 "최소저장"이 걸리므로 그것도 회귀다.
    const layoutAndWhitespace = objects.filter((object) =>
      ['OBJ-SECTION-LAYOUT-PROPERTY', 'OBJ-WHITESPACE-STRUCTURE'].includes(
        object.classification.reasonCode,
      ),
    );
    expect(layoutAndWhitespace.length).toBeGreaterThan(0);
    for (const object of layoutAndWhitespace) {
      expect(object.classification.objectClass).toBe('PRESERVE_ONLY');
      expect(object.classification.capsVerdict).toBe(false);
    }
    // 상한을 유발하는 ELEMENT는 하나도 없다.
    expect(
      objects.filter(
        (object) =>
          object.scope === 'ELEMENT' &&
          object.classification.capsVerdict &&
          (object.classification.objectClass === 'PRESERVE_ONLY' ||
            object.classification.objectClass === 'FLATTEN_EXPORT_ONLY'),
      ),
    ).toEqual([]);
  });

  it('레이아웃 컨트롤은 PRESERVED 블록 자리를 차지하지 않는다 (제한 아이콘 방지)', () => {
    // 등급이 PRESERVE_ONLY로 되돌아갔어도 배치 의도는 유지되어야 한다
    // (리뷰 M-3). hp:colPr이 블록 흐름에 자리를 잡으면 CC-150 편집기가
    // §8.4가 "정상"으로 규정한 대상에 보존 객체 표시를 낸다.
    const preserved = withoutPageNumber.ir.sections
      .flatMap((section) => section.blocks)
      .filter((block) => block.kind === 'PRESERVED');
    expect(
      preserved.filter((block) =>
        block.kind === 'PRESERVED'
          ? block.classification.reasonCode === 'OBJ-SECTION-LAYOUT-PROPERTY'
          : false,
      ),
    ).toEqual([]);
  });

  it('hp:fwSpace가 선행하는 문단의 텍스트에 공백이 들어간다 (§1.6-3)', () => {
    // 리뷰 M-4. 합성 픽스처는 `<hp:fwSpace/><hp:t>…</hp:t>` 순서라 고정폭
    // 빈칸이 **문단 맨 앞**에 온다 — 실 코퍼스에는 없는 배치이고, §1.6-4가
    // 계층 정렬 키로 쓰는 leadingWhitespace가 바로 이 자리다.
    const texts = withoutPageNumber.build.paragraphs.map((source) =>
      source.paragraph.runs.map((run) => run.text).join(''),
    );
    expect(texts).toContain(' 공백 구성요소둘째 줄');
    // 정규화 전에는 '공백 구성요소둘째 줄'(선행 공백 없음)이었다.
    expect(texts).not.toContain('공백 구성요소둘째 줄');
  });

  it('AUTO여도 무손실은 그대로다 (I1~I7 통과, unmanifested Part 보존)', () => {
    expect(withoutPageNumber.invariants?.ok).toBe(true);
    expect(withoutPageNumber.package.unmanifestedParts.length).toBeGreaterThan(0);
    expect(withoutPageNumber.ir.unknownParts.length).toBeGreaterThan(0);
  });
});

describe('합성 픽스처 — 결정성', () => {
  it('같은 픽스처를 두 번 조립하면 바이트가 같다(디스크 산출물 없음)', () => {
    for (const id of SYNTH_FIXTURE_IDS) {
      expect(Buffer.from(synthHwpx(id)).equals(Buffer.from(synthHwpx(id)))).toBe(true);
    }
  });

  it('CORPUS.yaml 주석이 열거한 9종을 하나도 잃지 않는다', () => {
    // 목록은 CC-140 리뷰로 늘어났다(m-1/m-2/m-9/G-2). 늘어나는 것은 좋지만
    // 줄어드는 것은 안 된다 — CORPUS.yaml 주석이 약속한 9종은 계약이다.
    for (const id of CORPUS_DECLARED_SYNTH_FIXTURE_IDS) {
      expect(SYNTH_FIXTURE_IDS).toContain(id);
    }
    expect(SYNTH_FIXTURE_IDS).toEqual([
      'valid',
      'no-restricted-object',
      'zip-signature-broken',
      'zip-bomb',
      'path-traversal',
      'doctype-xxe',
      'missing-header',
      'dangling-parapr',
      'duplicate-entry',
      'flatten-only-object',
      'multi-section',
      'symlink-entry',
      'encrypted-entry',
      'data-descriptor',
      'zip64-locator',
      'zip64-entry-count',
      'deep-xml-nesting',
      'dangling-styleref',
      'empty-table-cell',
    ]);
    // 유니온과 목록이 어긋나면 새 픽스처가 조립만 되고 아무도 쓰지 않는다.
    expect(new Set(SYNTH_FIXTURE_IDS).size).toBe(SYNTH_FIXTURE_IDS.length);
  });
});
