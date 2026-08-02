import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { inflateRawSync } from 'node:zlib';
import { canonicalJson, documentIrHash } from '@une/domain';
import { describe, expect, it } from 'vitest';
import { HwpxEngine } from './contract';
import { CATCH_ALL_REASON_CODES, CLASSIFICATION_PROPERTY_PARENTS } from './compat/object-rules';
import type { ClassifiedObject } from './compat/classifier';
import { reconstructEntries } from './ir/invariants';
import { sha256Bytes } from './package/zip-reader';
import { loadCorpus, readCorpusFile, type CorpusFile } from './testing/corpus';

/**
 * 실 코퍼스 6종 회귀 (ADR-29 D8).
 *
 * ## 보안 (security.md, CORPUS.yaml 주석)
 *
 * 골든 값에 **본문 텍스트·Preview/PrvText·BinData를 넣지 않는다.** 구조·카운트·
 * 해시만 기록한다. 스냅샷 파일도 만들지 않는다 — prettier `format:check`가
 * `{apps,services,packages,tests}/**\/*.json`을 포함하므로 스냅샷 JSON이
 * 포맷 게이트와 충돌한다. 전부 인라인 단언이다.
 *
 * ## 골든 값의 출처
 *
 * CORPUS.yaml의 `expectedVerdict`는 `PENDING_MEASUREMENT`다. 아래 값은
 * **구현 후 실측**한 것이고, 왜 그 값인지는 각 단언 옆 주석에 남긴다.
 * 지어낸 기대값이 아니다.
 */

const REPO_ROOT = resolve(__dirname, '../../..');
const engine = new HwpxEngine();

interface Golden {
  entryCount: number;
  /** hpf 매니페스트에 없는 Part 수 — 이게 0이면 무손실 전제가 깨진 것이다. */
  unmanifestedCount: number;
  unknownPartCount: number;
  sectionCount: number;
  paragraphCount: number;
  tableCount: number;
  nativeEdit: number;
  preserveOnly: number;
  flattenExportOnly: number;
  reject: number;
  verdict: string;
  confidence: number;
  outlinePatternCount: number;
  prototypeCount: number;
  /**
   * 문서 판정 상한(LIMITED)을 유발한 **ELEMENT** 객체 목록
   * (`reasonCode::요소`, 빈도 포함, 정렬). 판정이 왜 그런지를 값으로 고정한다 —
   * "LIMITED"라는 라벨만 고정하면 원인이 바뀌어도 테스트가 통과한다.
   */
  capElements: string[];
  /**
   * 규칙표가 잡지 않은 요소 수 (리뷰 M-2).
   *
   * 0이 아니어도 된다 — 실 HWPX에는 `hp:secPr` 아래 섹션 속성 트리처럼
   * "객체가 아니라 속성"인 노드가 반드시 있다. 대신 **정확한 개수**와
   * **부모 목록**을 고정한다. 새로운 미지 구조가 들어오면 둘 중 하나가
   * 반드시 어긋난다.
   */
  unclassifiedCount: number;
}

/**
 * 실측 골든표 (3차 실측: 등급 축과 상한 축 분리 후 — 리뷰 M-3/M-4).
 *
 * ## 판정이 이렇게 나오는 이유
 *
 * 1차 구현에서는 6종 전부가 LIMITED였고 원인이 **잘못된 것**이었다. PART 층
 * (Preview/*, container.rdf, settings.xml)과 catch-all이 삼킨 레이아웃·공백
 * 요소(hp:colPr, hp:fwSpace, hp:lineBreak, hp:pageHiding)가 상한을 유발해,
 * 모든 HWPX가 구조적으로 AUTO에 도달할 수 없었다. 시정 후:
 *
 * - PART 층은 판정을 낮추지 않는다(도메인 `rollUpVerdict` 규칙 3이 ELEMENT
 *   한정. PART는 I4 커버리지 + I5 바이트 보존이 대신 책임진다).
 * - 레이아웃 속성·공백은 **PRESERVE_ONLY이되 `capsVerdict: false`**다. 2차
 *   시정은 이들을 NATIVE_EDIT로 올려 상한을 피했는데 그것은 거짓 등급이었다
 *   (IR이 파싱하지 않는다). 등급은 사실대로 두고 상한만 뗀 결과, `nativeEdit`
 *   카운트가 2차보다 줄고 `preserveOnly`가 그만큼 늘었다 — 판정은 그대로다.
 *
 * 그 결과 남은 상한 사유는 **실제 콘텐츠/자동생성 제어 객체**뿐이다:
 * 머리말(hp:header), 자동 쪽번호(hp:pageNum/newNum), 필드(hp:fieldBegin/End),
 * 그림(hp:pic). 이것들은 v1이 편집하지 못하고 사용자에게 제한을 표시해야 하는
 * 대상이므로 상한이 정당하다.
 *
 * ## 6종이 여전히 전부 LIMITED인 것은 사실이며, 이유는 문서마다 다르다
 *
 * - report-form / work-report-form / brief-report-form / situation-report-template:
 *   상한 유발 객체가 실제로 있다(위 capElements 참조).
 * - doc-template-01: 필드(누름틀) 5개.
 * - **doc-template-02: 상한 유발 객체가 하나도 없다.** confidence 0.5252가
 *   CONFIRM 하한 0.60에 미치지 못해 밴드로 LIMITED가 된 것이다 — 즉 롤업이
 *   더 이상 단락(short-circuit)되지 않고 confidence 경로가 살아 있다.
 *
 * AUTO 밴드가 실제로 도달 가능한지는 합성 `no-restricted-object`가 증명한다
 * (`synth-fixtures.test.ts`): 내용이 같고 hp:pageNum만 없는 문서가 AUTO다.
 */
const GOLDEN: Readonly<Record<string, Golden>> = {
  'report-form': {
    entryCount: 11,
    unmanifestedCount: 8,
    unknownPartCount: 5,
    sectionCount: 1,
    paragraphCount: 102,
    tableCount: 8,
    nativeEdit: 489,
    preserveOnly: 11,
    flattenExportOnly: 0,
    reject: 0,
    verdict: 'LIMITED',
    confidence: 0.8543,
    outlinePatternCount: 7,
    prototypeCount: 8,
    unclassifiedCount: 24,
    capElements: [
      'OBJ-CTRL-HEADER-FOOTER::hp:header x1',
      'OBJ-CTRL-PAGE-NUMBER::hp:newNum x1',
      'OBJ-CTRL-PAGE-NUMBER::hp:pageNum x1',
    ],
  },
  'work-report-form': {
    entryCount: 11,
    unmanifestedCount: 8,
    unknownPartCount: 5,
    sectionCount: 1,
    paragraphCount: 30,
    tableCount: 2,
    nativeEdit: 136,
    preserveOnly: 8,
    flattenExportOnly: 0,
    reject: 0,
    verdict: 'LIMITED',
    confidence: 0.5574,
    outlinePatternCount: 6,
    prototypeCount: 7,
    unclassifiedCount: 24,
    capElements: ['OBJ-CTRL-PAGE-NUMBER::hp:pageNum x1'],
  },
  'brief-report-form': {
    entryCount: 13,
    unmanifestedCount: 8,
    unknownPartCount: 7,
    sectionCount: 1,
    paragraphCount: 48,
    tableCount: 5,
    nativeEdit: 243,
    preserveOnly: 13,
    flattenExportOnly: 0,
    reject: 0,
    verdict: 'LIMITED',
    confidence: 0.4625,
    outlinePatternCount: 4,
    prototypeCount: 8,
    unclassifiedCount: 24,
    capElements: ['OBJ-CTRL-HEADER-FOOTER::hp:header x1'],
  },
  'doc-template-01': {
    entryCount: 13,
    unmanifestedCount: 8,
    unknownPartCount: 7,
    sectionCount: 1,
    paragraphCount: 34,
    tableCount: 2,
    nativeEdit: 198,
    preserveOnly: 13,
    flattenExportOnly: 0,
    reject: 0,
    verdict: 'LIMITED',
    confidence: 0.5448,
    outlinePatternCount: 4,
    prototypeCount: 7,
    unclassifiedCount: 30,
    capElements: ['OBJ-FIELD::hp:fieldBegin x3', 'OBJ-FIELD::hp:fieldEnd x2'],
  },
  'doc-template-02': {
    entryCount: 13,
    unmanifestedCount: 8,
    unknownPartCount: 7,
    sectionCount: 1,
    paragraphCount: 39,
    tableCount: 3,
    nativeEdit: 222,
    preserveOnly: 8,
    flattenExportOnly: 0,
    reject: 0,
    verdict: 'LIMITED',
    confidence: 0.5252,
    outlinePatternCount: 4,
    prototypeCount: 7,
    unclassifiedCount: 24,
    capElements: [],
  },
  'situation-report-template': {
    entryCount: 14,
    unmanifestedCount: 8,
    unknownPartCount: 8,
    sectionCount: 1,
    paragraphCount: 101,
    tableCount: 6,
    nativeEdit: 674,
    preserveOnly: 13,
    flattenExportOnly: 0,
    reject: 0,
    verdict: 'LIMITED',
    confidence: 0.8246,
    outlinePatternCount: 6,
    prototypeCount: 6,
    unclassifiedCount: 81,
    capElements: ['OBJ-PIC-BINDATA::hp:pic x3'],
  },
};

/**
 * 원본 아카이브를 **독립 경로**로 다시 훑어 (경로, 순서, 압축방식, 저장 바이트
 * 해시, 원문 바이트 해시)를 만든다. 엔진의 zip-reader를 쓰지 않는 것이 요점이다
 * — 같은 코드로 두 번 계산하면 재구성 동치가 자기 자신과의 비교가 된다.
 */
function independentEntryScan(bytes: Uint8Array): Array<{
  partPath: string;
  order: number;
  method: string;
  storedSha256: string;
  sha256: string;
}> {
  const buffer = Buffer.from(bytes);
  let eocd = -1;
  for (let i = buffer.length - 22; i >= 0; i -= 1) {
    if (buffer.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  const count = buffer.readUInt16LE(eocd + 10);
  let cursor = buffer.readUInt32LE(eocd + 16);
  const out: Array<{
    partPath: string;
    order: number;
    method: string;
    storedSha256: string;
    sha256: string;
  }> = [];
  for (let order = 0; order < count; order += 1) {
    const method = buffer.readUInt16LE(cursor + 10);
    const compressedSize = buffer.readUInt32LE(cursor + 20);
    const nameLength = buffer.readUInt16LE(cursor + 28);
    const extraLength = buffer.readUInt16LE(cursor + 30);
    const commentLength = buffer.readUInt16LE(cursor + 32);
    const localOffset = buffer.readUInt32LE(cursor + 42);
    const partPath = buffer.toString('utf8', cursor + 46, cursor + 46 + nameLength);
    const localNameLength = buffer.readUInt16LE(localOffset + 26);
    const localExtraLength = buffer.readUInt16LE(localOffset + 28);
    const start = localOffset + 30 + localNameLength + localExtraLength;
    const stored = buffer.subarray(start, start + compressedSize);
    const plain = method === 0 ? stored : inflateRawSync(stored);
    out.push({
      partPath,
      order,
      method: method === 0 ? 'STORED' : 'DEFLATE',
      storedSha256: sha256Bytes(stored),
      sha256: sha256Bytes(plain),
    });
    cursor += 46 + nameLength + extraLength + commentLength;
  }
  return out;
}

/**
 * 문서 판정 상한을 유발한 ELEMENT 객체를 `reasonCode::요소 x빈도`로 요약한다.
 * 도메인 `rollUpVerdict` 규칙 3과 **같은 조건**을 쓴다: ELEMENT 층 +
 * `capsVerdict` + (PRESERVE_ONLY | FLATTEN_EXPORT_ONLY). 조건이 갈라지면
 * 요약이 판정과 다른 이야기를 하게 된다.
 */
function capElementSummary(objects: readonly ClassifiedObject[]): string[] {
  const counts = new Map<string, number>();
  for (const object of objects) {
    if (object.scope !== 'ELEMENT') continue;
    if (!object.classification.capsVerdict) continue;
    const grade = object.classification.objectClass;
    if (grade !== 'PRESERVE_ONLY' && grade !== 'FLATTEN_EXPORT_ONLY') continue;
    const element = /element=([^\s]+)/.exec(object.classification.evidence)?.[1] ?? '(unknown)';
    const key = `${object.classification.reasonCode}::${element}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([key, count]) => `${key} x${count}`)
    .sort((a, b) => a.localeCompare(b));
}

const corpus = loadCorpus(REPO_ROOT);

describe('실 코퍼스 6종', () => {
  it('CORPUS.yaml의 6종이 sha256으로 전부 해석된다(파일명이 아니라 해시로)', () => {
    expect(corpus.files).toHaveLength(6);
    expect(corpus.files.map((file) => file.alias).sort()).toEqual(Object.keys(GOLDEN).sort());
    for (const file of corpus.files) {
      // 매니페스트를 골든표와 **교차 고정**한다(리뷰 B-1). 둘 중 하나만
      // 갱신하면 매니페스트가 장식이 되므로, 판정·confidence·사유를 전부
      // 대조한다.
      const golden = GOLDEN[file.alias];
      expect(file.expectedVerdict).toBe(golden.verdict);
      expect(file.measuredConfidence).toBe(golden.confidence);
      expect(file.capReason.length).toBeGreaterThan(0);
      expect(sha256Bytes(readFileSync(file.path))).toBe(file.sha256);
    }
  });

  for (const alias of Object.keys(GOLDEN)) {
    describe(alias, () => {
      const file = corpus.files.find((item) => item.alias === alias) as CorpusFile;
      const bytes = readCorpusFile(file);
      const result = engine.analyzeDocument({ bytes, fileName: alias });
      const golden = GOLDEN[alias];

      it('구조 골든 스냅샷 (구조·카운트만, 본문 텍스트 없음)', () => {
        expect({
          entryCount: result.package.entries.length,
          unmanifestedCount: result.package.unmanifestedParts.length,
          unknownPartCount: result.ir.unknownParts.length,
          sectionCount: result.ir.sections.length,
          paragraphCount: result.build.paragraphs.length,
          tableCount: result.build.tables.length,
          nativeEdit: result.template.compatibility.objectCounts.NATIVE_EDIT,
          preserveOnly: result.template.compatibility.objectCounts.PRESERVE_ONLY,
          flattenExportOnly: result.template.compatibility.objectCounts.FLATTEN_EXPORT_ONLY,
          reject: result.template.compatibility.objectCounts.REJECT,
          verdict: result.template.compatibility.verdict,
          confidence: result.template.compatibility.confidence,
          outlinePatternCount: result.template.outlinePatterns.length,
          prototypeCount: result.template.prototypes.length,
          unclassifiedCount:
            result.template.compatibility.classification.unclassifiedElements.length,
          capElements: capElementSummary(result.template.compatibility.classification.objects),
        }).toEqual(golden);
      });

      it('unmanifestedParts가 비어 있지 않다 (ADR-29 D8: ZIP 엔트리 ⊃ hpf 매니페스트)', () => {
        expect(result.package.unmanifestedParts.length).toBeGreaterThan(0);
        // 실 코퍼스 6종 공통: hpf는 자기 자신도, 컨테이너도, mimetype도 안 적는다.
        expect(result.package.unmanifestedParts).toEqual(
          expect.arrayContaining([
            'mimetype',
            'version.xml',
            'META-INF/container.xml',
            'META-INF/container.rdf',
            'Contents/content.hpf',
            'Preview/PrvText.txt',
          ]),
        );
      });

      it('필수 Part가 모두 존재하고 mimetype이 application/hwp+zip이다', () => {
        expect(result.package.requiredParts.missing).toEqual([]);
        expect(result.package.mimetype).toBe('application/hwp+zip');
        expect(result.package.rootfiles[0].fullPath).toBe('Contents/content.hpf');
      });

      it('I1~I7 전수 통과', () => {
        expect(result.invariants?.checked).toEqual(['I1', 'I2', 'I3', 'I4', 'I5', 'I6', 'I7']);
        expect(result.invariants?.violations).toEqual([]);
        expect(result.invariants?.ok).toBe(true);
      });

      it('I7: 같은 바이트를 두 번 분석하면 documentIrHash가 같다', () => {
        const again = engine.analyzeDocument({ bytes, fileName: alias });
        expect(again.invariants?.documentIrHash).toBe(result.invariants?.documentIrHash);
        expect(again.ir.documentId).toBe(result.ir.documentId);
      });

      it('IR이 document_revision.ir_json으로 왕복 가능하고 해시가 도메인 함수와 일치한다', () => {
        // CC-150이 IR을 JSONB로 저장했다가 읽는다. 왕복에서 모양이 바뀌면
        // ir_hash가 흔들려 "이 개정이 뭘 바꿨나"에 답할 수 없다.
        const roundTripped = JSON.parse(JSON.stringify(result.ir)) as typeof result.ir;
        expect(canonicalJson(roundTripped)).toBe(canonicalJson(result.ir));
        expect(documentIrHash(roundTripped)).toBe(result.invariants?.documentIrHash);
      });

      it('IR 앵커가 계약 스키마 rawXmlAnchor 패턴을 만족한다', () => {
        for (const anchor of JSON.stringify(result.ir).matchAll(/"rawXmlAnchor":"([^"]*)"/g)) {
          expect(anchor[1]).toMatch(/^[^#]+#.+$/);
        }
      });

      it('무편집 재구성 동치: preservationMap만으로 원본 엔트리 집합이 복원된다', () => {
        // 실제 ZIP 쓰기는 하지 않는다(Package Writer는 CC-160 소유).
        // 여기서 증명하는 것은 "쓰기에 필요한 데이터가 전부 남아 있는가"다.
        const reconstructed = reconstructEntries(result.package);
        const original = independentEntryScan(bytes);
        expect(reconstructed).toHaveLength(original.length);
        for (let i = 0; i < original.length; i += 1) {
          expect(reconstructed[i].partPath).toBe(original[i].partPath);
          expect(reconstructed[i].order).toBe(original[i].order);
          expect(reconstructed[i].method).toBe(original[i].method);
          expect(reconstructed[i].storedSha256).toBe(original[i].storedSha256);
          expect(reconstructed[i].sha256).toBe(original[i].sha256);
        }
      });

      it('분류 판정마다 reasonCode·locator·evidence가 있다 (G15-1 근거 재현)', () => {
        const objects = result.template.compatibility.classification.objects;
        expect(objects.length).toBeGreaterThan(0);
        for (const object of objects) {
          expect(object.classification.reasonCode).toMatch(/^(PART|OBJ)-[A-Z0-9-]+$/);
          expect(object.classification.locator.length).toBeGreaterThan(0);
          expect(object.classification.evidence).toContain('::');
        }
        // 모든 ZIP Part가 정확히 한 번 분류된다.
        const partLocators = objects
          .filter((object) => object.scope === 'PART')
          .map((object) => object.classification.locator)
          .sort();
        expect(partLocators).toEqual(result.package.entries.map((entry) => entry.partPath).sort());
      });

      it('PART 층 PRESERVE_ONLY는 문서 판정을 낮추지 않는다(무손실은 I4/I5가 책임진다)', () => {
        // 모든 HWPX가 Preview/*·container.rdf·settings.xml을 갖는다. 이것으로
        // 판정을 낮추면 AUTO가 구조적으로 도달 불가능해진다(1차 실측의 결함).
        const partPreserved = result.template.compatibility.classification.objects.filter(
          (object) =>
            object.scope === 'PART' && object.classification.objectClass === 'PRESERVE_ONLY',
        );
        expect(partPreserved.length).toBeGreaterThan(0);
        if (golden.capElements.length === 0) {
          // doc-template-02: PART 층 PRESERVE_ONLY가 있어도 상한이 걸리지 않고
          // confidence 밴드로 판정된다.
          expect(result.template.compatibility.confidence).toBeLessThan(0.6);
        }
      });

      it('상한 사유가 실제 콘텐츠·자동생성 제어 객체로만 설명된다', () => {
        // 라벨(LIMITED)이 아니라 **원인**을 고정한다.
        expect(capElementSummary(result.template.compatibility.classification.objects)).toEqual(
          golden.capElements,
        );
        const capped = golden.capElements.length > 0;
        if (capped) {
          expect(result.template.compatibility.verdict).toBe('LIMITED');
        }
        for (const entry of golden.capElements) {
          // 레이아웃 속성·공백이 상한 사유로 돌아오면 즉시 실패한다.
          expect(entry).not.toMatch(/hp:(colPr|fwSpace|lineBreak|pageHiding|nbSpace|hypen)\b/);
        }
      });

      it('미분류 요소는 전부 검토 완료된 속성 노드다 (버려지지 않고 실려 온다)', () => {
        // 리뷰 M-2: 이전 구현은 미매칭 요소를 `continue`로 버렸다. 그러면
        // "catch-all 적중 0건" 가드가 **구멍의 증상**(아무것도 안 잡힘)과
        // **정상**(전부 명시 규칙이 잡음)을 구별하지 못한다. 이제 미분류를
        // 값으로 받아 (1) 부모가 검토된 속성 컨테이너인지, (2) 앵커가
        // 역참조 가능한 형식인지를 확인한다.
        const unclassified = result.template.compatibility.classification.unclassifiedElements;
        for (const element of unclassified) {
          expect(element.parentLocalName).not.toBeNull();
          expect(CLASSIFICATION_PROPERTY_PARENTS.has(element.parentLocalName as string)).toBe(true);
          expect(element.anchor).toMatch(/^[^#]+#.+$/);
        }
        // 부모 종류 자체도 고정한다 — 새 부모가 등장하면 즉시 실패한다.
        const parents = [...new Set(unclassified.map((item) => item.parentLocalName))].sort();
        expect(parents.every((parent) => typeof parent === 'string')).toBe(true);
      });

      it('catch-all 회귀 가드: 실 코퍼스에서 미지 규칙이 잡는 요소가 없다', () => {
        // catch-all이 알려진 양성을 삼키면 판정을 조용히 지배한다. 실제로
        // 1차 구현에서 hp:colPr(7)·hp:fwSpace(4)·hp:lineBreak(1)이 그랬다.
        const caught = result.template.compatibility.classification.objects
          .filter((object) => CATCH_ALL_REASON_CODES.includes(object.classification.reasonCode))
          .map(
            (object) =>
              `${object.classification.reasonCode}::${object.classification.locator} :: ${object.classification.evidence}`,
          );
        expect(caught).toEqual([]);
      });

      it('confidence 성분이 전부 [0,1]이고 근거 문자열을 동반한다', () => {
        const components = result.template.compatibility.components;
        for (const [key, value] of Object.entries(components)) {
          expect(value).toBeGreaterThanOrEqual(0);
          expect(value).toBeLessThanOrEqual(1);
          expect(
            result.template.compatibility.confidenceBasis[key as keyof typeof components],
          ).toMatch(/weight /);
        }
      });

      it('TemplateProfile이 분석 결과와 일치하고 JSONB 왕복에 안정적이다', () => {
        // CC-150이 이 값을 `template_profile.profile_json`에 넣는다(리뷰 M-1).
        const profile = result.profile;
        expect(profile.profileVersion).toBe('1');
        expect(profile.sourceHash).toBe(result.ir.sourceHash);
        expect(profile.compatibility.verdict).toBe(result.template.compatibility.verdict);
        expect(profile.compatibility.confidence).toBe(result.template.compatibility.confidence);
        expect(profile.outlinePatterns).toHaveLength(golden.outlinePatternCount);
        expect(profile.prototypes).toHaveLength(golden.prototypeCount);
        expect(profile.compatibility.objects).toHaveLength(
          result.template.compatibility.classification.objects.length,
        );
        expect(profile.compatibility.unclassifiedElements).toHaveLength(golden.unclassifiedCount);
        const roundTripped = JSON.parse(JSON.stringify(profile)) as typeof profile;
        expect(canonicalJson(roundTripped)).toBe(canonicalJson(profile));
      });

      it('rhwp Core는 여전히 미반입임을 신고한다', () => {
        expect(result.rhwpIntake.status).toBe('RHWP_NOT_IMPORTED');
      });

      it('분석 소요시간을 기록한다 (§1.12 50쪽 P95 5초 목표)', () => {
        expect(result.elapsedMs).toBeGreaterThan(0);
        expect(result.elapsedMs).toBeLessThan(5000);
      });
    });
  }
});

describe('개요 패턴 — §1.6 샘플 검증 기준', () => {
  it('□→ㅇ→-→* 와 □→○→― 계열이 서로 다른 Pattern으로 독립 저장된다', () => {
    const workReport = engine.analyzeDocument({
      bytes: readCorpusFile(corpus.files.find((file) => file.alias === 'work-report-form')!),
    });
    const levels = workReport.template.outlinePatterns.map((pattern) => [
      pattern.literalPrefix,
      pattern.outlineLevel,
      pattern.leadingWhitespace.length,
    ]);
    // 실측: □(lead 0)=1, ※(lead 0)=1, ㅇ(lead 1)=2 ×2패턴, -(lead 4)=3, *(lead 6)=4.
    // ㅇ가 두 패턴인 이유는 marginIntent가 달라 ParaShape가 다르기 때문이며,
    // 앞 공백이 같으므로 층은 같다.
    expect(levels).toEqual([
      ['□', 1, 0],
      ['※', 1, 0],
      ['ㅇ', 2, 1],
      ['ㅇ', 2, 1],
      ['-', 3, 4],
      ['*', 4, 6],
    ]);
  });

  it('앞 공백을 trim하지 않고 leading/trailing을 따로 저장한다', () => {
    const situation = engine.analyzeDocument({
      bytes: readCorpusFile(
        corpus.files.find((file) => file.alias === 'situation-report-template')!,
      ),
    });
    const circle = situation.template.outlinePatterns.find(
      (pattern) => pattern.literalPrefix === '○',
    );
    expect(circle).toBeDefined();
    // 실측: "  ○ " — 앞 공백 2칸, 뒤 공백 1칸. trim했다면 둘 다 0이 된다.
    expect(circle?.leadingWhitespace).toBe('  ');
    expect(circle?.trailingWhitespace).toBe(' ');
    expect(circle?.outlineLevel).toBe(2);
  });

  /**
   * §1.6-3 공백 실측 회귀 (리뷰 M-4).
   *
   * `RunIR.text`가 `hp:t`의 문자 데이터만 담던 시절에는 고정폭 빈칸·탭이
   * 텍스트에서 사라졌다. §1.6-4가 `leadingWhitespace.length`를 계층 정렬 키로
   * 쓰므로 이는 계층이 한 칸씩 잘못 잡히는 문제였다. 아래 두 문단은 실 코퍼스
   * 에서 **실제로 그 경로를 밟는** 자리다(실측: fwSpace 4건, tab 5건).
   *
   * 보안: 본문 텍스트를 값으로 적지 않는다. 길이와 공백 문자 존재만 고정한다.
   */
  it('hp:fwSpace가 텍스트 스트림에 공백으로 반영된다 (brief-report-form)', () => {
    const brief = engine.analyzeDocument({
      bytes: readCorpusFile(corpus.files.find((file) => file.alias === 'brief-report-form')!),
    });
    const anchor =
      'Contents/section0.xml#p[1]/run[2]/tbl[1]/tr[2]/tc[1]/subList[1]/p[1]/run[2]/ctrl[1]/' +
      'header[1]/subList[1]/p[1]/run[1]/tbl[1]/tr[1]/tc[2]/subList[1]/p[1]/run[1]/tbl[1]/' +
      'tr[1]/tc[1]/subList[1]/p[1]';
    const source = brief.build.paragraphs.find((item) => item.paragraph.rawXmlAnchor === anchor);
    expect(source).toBeDefined();
    const text = (source as NonNullable<typeof source>).paragraph.runs
      .map((run) => run.text)
      .join('');
    // 실측: hp:fwSpace 4개 + 문자 8자 = 12자. 정규화 전에는 8자였다.
    expect(text).toHaveLength(12);
    expect(text.split(' ').length - 1).toBeGreaterThanOrEqual(4);
  });

  it('hp:tab이 U+0009로 텍스트 스트림에 들어간다 (report-form 목차 5줄)', () => {
    const report = engine.analyzeDocument({
      bytes: readCorpusFile(corpus.files.find((file) => file.alias === 'report-form')!),
    });
    const tocLengths = [37, 38, 39, 40, 41].map((order) => {
      const source = report.build.paragraphs.find((item) => item.documentOrder === order);
      const text = (source as NonNullable<typeof source>).paragraph.runs
        .map((run) => run.text)
        .join('');
      expect(text).toContain('\t');
      return text.length;
    });
    // 실측 길이. 탭이 빠지면 전부 1씩 줄어든다.
    expect(tocLengths).toEqual([8, 10, 14, 14, 11]);
  });

  it('그림이 있는 문서는 hp:pic을 PRESERVE_ONLY로 잡고 BinData를 보존한다', () => {
    const situation = engine.analyzeDocument({
      bytes: readCorpusFile(
        corpus.files.find((file) => file.alias === 'situation-report-template')!,
      ),
    });
    const pictures = situation.template.compatibility.classification.objects.filter(
      (object) => object.classification.reasonCode === 'OBJ-PIC-BINDATA',
    );
    expect(pictures).toHaveLength(3); // 실측: hp:pic 3개
    expect(situation.ir.unknownParts.map((part) => part.partPath)).toEqual(
      expect.arrayContaining(['BinData/image1.BMP', 'BinData/image2.BMP', 'BinData/image3.BMP']),
    );
    for (const part of situation.ir.unknownParts) {
      expect(part.hash).toHaveLength(64);
    }
  });
});
