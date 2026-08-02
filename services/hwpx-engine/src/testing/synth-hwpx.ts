import { deflateRawSync } from 'node:zlib';
import { crc32 } from '../package/zip-reader';

/**
 * 합성 HWPX 빌더 — **메모리에서 결정적으로 조립**한다. 디스크 산출물이 없다.
 *
 * 음성·희소 케이스는 실문서로 구할 수 없다(악성 ZIP을 커밋할 수도 없고,
 * 수식/OLE가 든 재난 보고 양식이 코퍼스에 없다). 그래서 합성이 필요하지만
 * **합성 파일을 저장소에 두면** 그 자체가 검증되지 않은 이진 자산이 되고,
 * 어느 시점엔가 "실문서"로 오해된다. 코드로 만들고 코드로 버린다.
 *
 * 결정성: mtime·압축 레벨·엔트리 순서를 전부 고정한다. 같은 함수 호출이 항상
 * 같은 바이트를 낸다(스냅샷 회귀의 전제).
 */

const DOS_TIME = 0;
const DOS_DATE = 0x0021; // 1980-01-01. 시각 의존을 없애기 위한 고정값.
const EXTERNAL_ATTRIBUTES = 0x81800020;

export interface SynthEntry {
  readonly path: string;
  readonly data: Uint8Array | string;
  readonly store?: boolean;
  /**
   * general purpose bit flag를 강제한다. 암호화(0x01)·data descriptor(0x08)
   * 음성 픽스처용(리뷰 m-9). local/central 양쪽에 같은 값을 쓴다.
   */
  readonly generalPurposeFlags?: number;
  /** external file attributes 강제. 심볼릭 링크(unix mode 0xA000) 음성용. */
  readonly externalFileAttributes?: number;
}

export interface BuildZipOptions {
  /**
   * EOCD 바로 앞에 ZIP64 EOCD locator(서명 0x07064b50)를 끼운다.
   * zip-reader가 ZIP64를 **명시적으로 거부**하는 경로의 음성 재현이다.
   */
  readonly appendZip64Locator?: boolean;
  /** EOCD의 엔트리 수를 0xFFFF로 덮어 ZIP64 sentinel 경로를 재현한다. */
  readonly zip64EntryCountSentinel?: boolean;
}

function toBytes(data: Uint8Array | string): Uint8Array {
  return typeof data === 'string' ? new Uint8Array(Buffer.from(data, 'utf8')) : data;
}

/** 최소 ZIP 라이터. HWPX 패키지 구조를 흉내내기 위한 테스트 전용이다. */
export function buildZip(
  entries: readonly SynthEntry[],
  options: BuildZipOptions = {},
): Uint8Array {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;

  for (const entry of entries) {
    const name = Buffer.from(entry.path, 'utf8');
    const raw = Buffer.from(toBytes(entry.data));
    const stored = entry.store === true;
    const payload = stored ? raw : deflateRawSync(raw, { level: 9 });
    const checksum = crc32(raw);

    const flags = entry.generalPurposeFlags ?? 0;
    const local = Buffer.alloc(30 + name.length);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(flags, 6);
    local.writeUInt16LE(stored ? 0 : 8, 8);
    local.writeUInt16LE(DOS_TIME, 10);
    local.writeUInt16LE(DOS_DATE, 12);
    local.writeUInt32LE(checksum, 14);
    local.writeUInt32LE(payload.length, 18);
    local.writeUInt32LE(raw.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);
    name.copy(local, 30);
    locals.push(local, payload);

    const central = Buffer.alloc(46 + name.length);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(flags, 8);
    central.writeUInt16LE(stored ? 0 : 8, 10);
    central.writeUInt16LE(DOS_TIME, 12);
    central.writeUInt16LE(DOS_DATE, 14);
    central.writeUInt32LE(checksum, 16);
    central.writeUInt32LE(payload.length, 20);
    central.writeUInt32LE(raw.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt16LE(0, 30);
    central.writeUInt16LE(0, 32);
    central.writeUInt16LE(0, 34);
    central.writeUInt16LE(0, 36);
    central.writeUInt32LE(entry.externalFileAttributes ?? EXTERNAL_ATTRIBUTES, 38);
    central.writeUInt32LE(offset, 42);
    name.copy(central, 46);
    centrals.push(central);

    offset += local.length + payload.length;
  }

  const centralBuffer = Buffer.concat(centrals);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  const entryCount = options.zip64EntryCountSentinel ? 0xffff : entries.length;
  eocd.writeUInt16LE(entryCount, 8);
  eocd.writeUInt16LE(entryCount, 10);
  eocd.writeUInt32LE(centralBuffer.length, 12);
  eocd.writeUInt32LE(offset, 16);
  eocd.writeUInt16LE(0, 20);

  const tail: Buffer[] = [];
  if (options.appendZip64Locator) {
    // ZIP64 EOCD locator: 서명(4) + disk(4) + relativeOffset(8) + totalDisks(4).
    const locator = Buffer.alloc(20);
    locator.writeUInt32LE(0x07064b50, 0);
    locator.writeUInt32LE(0, 4);
    locator.writeBigUInt64LE(0n, 8);
    locator.writeUInt32LE(1, 16);
    tail.push(locator);
  }
  tail.push(eocd);

  return new Uint8Array(Buffer.concat([...locals, centralBuffer, ...tail]));
}

const NS = [
  'xmlns:ha="http://www.hancom.co.kr/hwpml/2011/app"',
  'xmlns:hp="http://www.hancom.co.kr/hwpml/2011/paragraph"',
  'xmlns:hs="http://www.hancom.co.kr/hwpml/2011/section"',
  'xmlns:hc="http://www.hancom.co.kr/hwpml/2011/core"',
  'xmlns:hh="http://www.hancom.co.kr/hwpml/2011/head"',
  'xmlns:hpf="http://www.hancom.co.kr/schema/2011/hpf"',
  'xmlns:opf="http://www.idpf.org/2007/opf/"',
  'xmlns:ooxmlchart="http://www.hancom.co.kr/hwpml/2016/ooxmlchart"',
].join(' ');

const XML_DECLARATION = '<?xml version="1.0" encoding="UTF-8" standalone="yes" ?>';

function paraPr(id: number, left: number, intent: number): string {
  return (
    `<hh:paraPr id="${id}" tabPrIDRef="0" condense="0">` +
    '<hh:align horizontal="LEFT" vertical="BASELINE"/>' +
    '<hh:heading type="NONE" idRef="0" level="0"/>' +
    '<hh:margin>' +
    `<hc:intent value="${intent}" unit="HWPUNIT"/>` +
    `<hc:left value="${left}" unit="HWPUNIT"/>` +
    '<hc:right value="0" unit="HWPUNIT"/>' +
    '<hc:prev value="0" unit="HWPUNIT"/>' +
    '<hc:next value="0" unit="HWPUNIT"/>' +
    '</hh:margin>' +
    '<hh:lineSpacing type="PERCENT" value="160" unit="HWPUNIT"/>' +
    '</hh:paraPr>'
  );
}

export const SYNTH_HEADER_XML =
  `${XML_DECLARATION}<hh:head ${NS} version="1.5" secCnt="1"><hh:refList>` +
  '<hh:paraProperties itemCnt="3">' +
  paraPr(0, 0, 0) +
  paraPr(1, 1000, 0) +
  paraPr(2, 2000, 0) +
  '</hh:paraProperties>' +
  '<hh:charProperties itemCnt="2">' +
  '<hh:charPr id="0" height="1000" textColor="#000000"><hh:fontRef hangul="0" latin="0"/></hh:charPr>' +
  '<hh:charPr id="1" height="1600" textColor="#000000"><hh:fontRef hangul="0" latin="0"/><hh:bold/></hh:charPr>' +
  '</hh:charProperties>' +
  '<hh:styles itemCnt="1"><hh:style id="0" type="PARA" name="바탕글" paraPrIDRef="0" charPrIDRef="0"/></hh:styles>' +
  '<hh:numberings itemCnt="1"><hh:numbering id="1" start="0"><hh:paraHead level="1" start="1" format="DIGIT">^1.</hh:paraHead></hh:numbering></hh:numberings>' +
  '</hh:refList></hh:head>';

function paragraph(paraPrId: number, charPrId: number, text: string, inner = ''): string {
  return (
    `<hp:p id="0" paraPrIDRef="${paraPrId}" styleIDRef="0" pageBreak="0" columnBreak="0" merged="0">` +
    `<hp:run charPrIDRef="${charPrId}">${inner}<hp:t>${text}</hp:t></hp:run>` +
    '<hp:linesegarray><hp:lineseg textpos="0" vertpos="0" vertsize="1000"/></hp:linesegarray>' +
    '</hp:p>'
  );
}

/**
 * 섹션 머리 문단. `withPageNumber=false`면 자동 쪽번호 컨트롤을 빼는데, 이는
 * 상한(§8.4 PRESERVE_ONLY)을 유발하는 실제 콘텐츠 객체가 하나도 없는 문서를
 * 만들기 위해서다 — confidence 밴드(AUTO/CONFIRM)가 실제로 도달 가능한지
 * 증명하는 유일한 방법이다. 단(hp:colPr) 속성은 남긴다: 레이아웃 속성은
 * 상한을 유발하지 않아야 한다는 것이 이번 시정의 핵심이므로 회귀로 지킨다.
 */
function secPrParagraph(withPageNumber: boolean): string {
  return (
    '<hp:p id="0" paraPrIDRef="0" styleIDRef="0"><hp:run charPrIDRef="0">' +
    '<hp:secPr id="" textDirection="HORIZONTAL"><hp:grid lineGrid="0" charGrid="0"/>' +
    '<hp:pagePr landscape="WIDELY" width="59528" height="84188" gutterType="LEFT_ONLY">' +
    '<hp:margin header="4251" footer="4251" gutter="0" left="5669" right="5669" top="4251" bottom="4251"/>' +
    '</hp:pagePr></hp:secPr>' +
    '<hp:ctrl><hp:colPr id="" type="NEWSPAPER" layout="LEFT" colCount="1"/></hp:ctrl>' +
    (withPageNumber
      ? '<hp:ctrl><hp:pageNum pos="BOTTOM_CENTER" formatType="DIGIT" sideChar="-"/></hp:ctrl>'
      : '') +
    '</hp:run><hp:linesegarray><hp:lineseg textpos="0"/></hp:linesegarray></hp:p>'
  );
}

const TABLE =
  '<hp:p id="0" paraPrIDRef="0" styleIDRef="0"><hp:run charPrIDRef="0">' +
  '<hp:tbl id="1" rowCnt="1" colCnt="2" borderFillIDRef="1">' +
  '<hp:tr>' +
  '<hp:tc name="" header="0"><hp:cellAddr colAddr="0" rowAddr="0"/><hp:cellSpan colSpan="1" rowSpan="1"/>' +
  '<hp:cellSz width="10000" height="1000"/>' +
  `<hp:subList id="" textDirection="HORIZONTAL">${paragraph(0, 0, '구분')}</hp:subList></hp:tc>` +
  '<hp:tc name="" header="0"><hp:cellAddr colAddr="1" rowAddr="0"/><hp:cellSpan colSpan="1" rowSpan="1"/>' +
  '<hp:cellSz width="10000" height="1000"/>' +
  `<hp:subList id="" textDirection="HORIZONTAL">${paragraph(0, 0, '내용')}</hp:subList></hp:tc>` +
  '</hp:tr></hp:tbl></hp:run>' +
  '<hp:linesegarray><hp:lineseg textpos="0"/></hp:linesegarray></hp:p>';

/**
 * 문단이 하나도 없는 셀을 가진 표 (리뷰 G-2).
 *
 * 현재 동작(HWPX-1005 DEGRADING + I6 위반 + 계약 스키마 `minItems: 1` 위반)을
 * **값으로 고정**하기 위한 픽스처다. CC-150이 저장 경로를 열 때 런타임에서
 * 처음 만나는 일이 없어야 한다. 빈 문단을 몰래 만들어 넣지 않는 것이 요점이다
 * — 그러면 무손실이 깨지고 원본에 없던 문단이 생긴다.
 */
const TABLE_WITH_EMPTY_CELL =
  '<hp:p id="0" paraPrIDRef="0" styleIDRef="0"><hp:run charPrIDRef="0">' +
  '<hp:tbl id="2" rowCnt="1" colCnt="1" borderFillIDRef="1">' +
  '<hp:tr><hp:tc name="" header="0"><hp:cellAddr colAddr="0" rowAddr="0"/>' +
  '<hp:cellSpan colSpan="1" rowSpan="1"/><hp:cellSz width="10000" height="1000"/>' +
  '<hp:subList id="" textDirection="HORIZONTAL"/></hp:tc></hp:tr></hp:tbl></hp:run>' +
  '<hp:linesegarray><hp:lineseg textpos="0"/></hp:linesegarray></hp:p>';

/** `styleIDRef`만 깨진 문단 — 복구 가능한 참조(리뷰 m-1) 회귀용. */
const DANGLING_STYLE_PARAGRAPH =
  '<hp:p id="0" paraPrIDRef="0" styleIDRef="777"><hp:run charPrIDRef="0">' +
  '<hp:t>스타일 참조가 깨진 문단</hp:t></hp:run>' +
  '<hp:linesegarray><hp:lineseg textpos="0"/></hp:linesegarray></hp:p>';

export interface SectionOptions {
  readonly paraPrIdOverride?: number;
  readonly withEquation?: boolean;
  readonly withTable?: boolean;
  /** 기본 true. false면 상한 유발 객체가 없는 문서가 된다. */
  readonly withPageNumber?: boolean;
  /** 고정폭 빈칸·줄바꿈을 넣어 "공백은 상한을 유발하지 않는다"를 회귀로 지킨다. */
  readonly withWhitespaceObjects?: boolean;
  /** 문단 없는 셀을 가진 표를 덧붙인다(G-2). */
  readonly withEmptyTableCell?: boolean;
  /** styleIDRef가 header.xml에 없는 문단을 덧붙인다(m-1). */
  readonly withDanglingStyleRef?: boolean;
}

export function synthSectionXml(options: SectionOptions = {}): string {
  const outlineParaPr = options.paraPrIdOverride ?? 1;
  const equation = options.withEquation
    ? '<hp:p id="0" paraPrIDRef="0" styleIDRef="0"><hp:run charPrIDRef="0">' +
      '<hp:equation id="9" textColor="#000000" baseUnit="1000" version="Equation Version 60">' +
      '<hp:script>x^2 + y^2 = z^2</hp:script></hp:equation></hp:run>' +
      '<hp:linesegarray><hp:lineseg textpos="0"/></hp:linesegarray></hp:p>'
    : '';
  const whitespace =
    options.withWhitespaceObjects === false
      ? ''
      : '<hp:p id="0" paraPrIDRef="2" styleIDRef="0"><hp:run charPrIDRef="0">' +
        '<hp:fwSpace/><hp:t>공백 구성요소<hp:lineBreak/>둘째 줄</hp:t></hp:run>' +
        '<hp:linesegarray><hp:lineseg textpos="0"/></hp:linesegarray></hp:p>';
  return (
    `${XML_DECLARATION}<hs:sec ${NS}>` +
    secPrParagraph(options.withPageNumber !== false) +
    paragraph(0, 1, '합성 보고 양식') +
    paragraph(outlineParaPr, 0, '□ 개요') +
    paragraph(2, 0, '  ○ 현황') +
    paragraph(2, 0, '  ○ 조치') +
    paragraph(outlineParaPr, 0, '□ 피해현황') +
    whitespace +
    (options.withTable === false ? '' : TABLE) +
    (options.withEmptyTableCell ? TABLE_WITH_EMPTY_CELL : '') +
    (options.withDanglingStyleRef ? DANGLING_STYLE_PARAGRAPH : '') +
    equation +
    '</hs:sec>'
  );
}

/**
 * 한도를 넘는 중첩을 가진 section XML (리뷰 m-2).
 *
 * 깊이만 만들면 되므로 내용은 최소로 둔다. 파서는 반복문이라 여기서 죽지
 * 않지만, 이후의 재귀 순회(`walk`/`canonicalJson`)가 `RangeError`로 죽는다 —
 * 그 전에 HWPX-1002로 거부하는 것이 이 픽스처가 지키는 계약이다.
 */
export function synthDeeplyNestedSectionXml(depth: number): string {
  const open = '<hp:container>'.repeat(depth);
  const close = '</hp:container>'.repeat(depth);
  return (
    `${XML_DECLARATION}<hs:sec ${NS}>` +
    '<hp:p id="0" paraPrIDRef="0" styleIDRef="0"><hp:run charPrIDRef="0">' +
    `${open}<hp:t>깊은 중첩</hp:t>${close}` +
    '</hp:run><hp:linesegarray><hp:lineseg textpos="0"/></hp:linesegarray></hp:p>' +
    '</hs:sec>'
  );
}

export const SYNTH_VERSION_XML =
  `${XML_DECLARATION}<hv:HCFVersion xmlns:hv="http://www.hancom.co.kr/hwpml/2011/version" ` +
  'tagetApplication="WORDPROCESSOR" major="5" minor="1" micro="1" buildNumber="0" os="1" ' +
  'xmlVersion="1.5" application="UNE Synthetic Fixture" appVersion="0"/>';

export const SYNTH_CONTAINER_XML =
  `${XML_DECLARATION}<ocf:container xmlns:ocf="urn:oasis:names:tc:opendocument:xmlns:container" ` +
  'xmlns:hpf="http://www.hancom.co.kr/schema/2011/hpf"><ocf:rootfiles>' +
  '<ocf:rootfile full-path="Contents/content.hpf" media-type="application/hwpml-package+xml"/>' +
  '</ocf:rootfiles></ocf:container>';

export function synthContentHpf(sectionCount: number): string {
  const items = [
    '<opf:item id="header" href="Contents/header.xml" media-type="application/xml"/>',
    ...Array.from(
      { length: sectionCount },
      (_unused, index) =>
        `<opf:item id="section${index}" href="Contents/section${index}.xml" media-type="application/xml"/>`,
    ),
    '<opf:item id="settings" href="settings.xml" media-type="application/xml"/>',
  ].join('');
  const refs = [
    '<opf:itemref idref="header" linear="yes"/>',
    ...Array.from(
      { length: sectionCount },
      (_unused, index) => `<opf:itemref idref="section${index}" linear="yes"/>`,
    ),
  ].join('');
  return (
    `${XML_DECLARATION}<opf:package ${NS} version="" unique-identifier="" id="">` +
    '<opf:metadata><opf:title/><opf:language>ko</opf:language></opf:metadata>' +
    `<opf:manifest>${items}</opf:manifest><opf:spine>${refs}</opf:spine></opf:package>`
  );
}

export const SYNTH_SETTINGS_XML = `${XML_DECLARATION}<ha:HWPApplicationSetting ${NS}><ha:CaretPosition listIDRef="0" paraIDRef="0" pos="0"/></ha:HWPApplicationSetting>`;

/**
 * 합성 픽스처 식별자. 음성·희소 9종은 CORPUS.yaml 주석 목록과 1:1 대응하고,
 * `valid`/`no-restricted-object`는 비교 기준용 양성 픽스처다.
 */
export type SynthFixtureId =
  | 'valid'
  | 'no-restricted-object'
  | 'zip-signature-broken'
  | 'zip-bomb'
  | 'path-traversal'
  | 'doctype-xxe'
  | 'missing-header'
  | 'dangling-parapr'
  | 'duplicate-entry'
  | 'flatten-only-object'
  | 'multi-section'
  // ── CC-140 리뷰로 추가된 음성·경계 픽스처 ────────────────────────────────
  // m-9: zip-reader의 방어 코드에 대응하는 음성 재현이 없어, 리팩터링 때
  // 조용히 사라져도 아무도 모르는 상태였다.
  | 'symlink-entry'
  | 'encrypted-entry'
  | 'data-descriptor'
  | 'zip64-locator'
  | 'zip64-entry-count'
  // m-2: XML 깊이 한도.
  | 'deep-xml-nesting'
  // m-1: 복구 가능한 참조 깨짐(styleIDRef)은 REJECT가 아니다.
  | 'dangling-styleref'
  // G-2: 문단 없는 표 셀.
  | 'empty-table-cell';

function baseEntries(sectionCount: number, sectionXml: readonly string[]): SynthEntry[] {
  return [
    { path: 'mimetype', data: 'application/hwp+zip', store: true },
    { path: 'version.xml', data: SYNTH_VERSION_XML, store: true },
    { path: 'Contents/header.xml', data: SYNTH_HEADER_XML },
    ...sectionXml.map((xml, index) => ({
      path: `Contents/section${index}.xml`,
      data: xml,
    })),
    { path: 'settings.xml', data: SYNTH_SETTINGS_XML },
    { path: 'Preview/PrvText.txt', data: '합성 미리보기' },
    { path: 'META-INF/container.rdf', data: '<?xml version="1.0"?><rdf:RDF xmlns:rdf="x"/>' },
    { path: 'Contents/content.hpf', data: synthContentHpf(sectionCount) },
    { path: 'META-INF/container.xml', data: SYNTH_CONTAINER_XML },
  ];
}

export function synthHwpx(fixture: SynthFixtureId): Uint8Array {
  switch (fixture) {
    case 'valid':
      return buildZip(baseEntries(1, [synthSectionXml()]));

    case 'no-restricted-object':
      // 상한(§8.4 PRESERVE_ONLY/FLATTEN) 유발 ELEMENT가 하나도 없는 문서.
      // 단 속성(hp:colPr)과 공백 객체(hp:fwSpace/hp:lineBreak)는 그대로 있다 —
      // 이들이 상한을 유발하지 않는다는 것이 이번 시정의 요지이기 때문이다.
      // 두 섹션으로 반복 근거를 늘려 confidence를 AUTO 밴드까지 올린다.
      return buildZip(
        baseEntries(2, [
          synthSectionXml({ withPageNumber: false }),
          synthSectionXml({ withPageNumber: false, withTable: false }),
        ]),
      );

    case 'zip-signature-broken': {
      // EOCD는 멀쩡하지만 선두 4바이트가 local header 서명이 아니다.
      const bytes = buildZip(baseEntries(1, [synthSectionXml()]));
      const broken = Uint8Array.prototype.slice.call(bytes, 0);
      broken[0] = 0x00;
      return broken;
    }

    case 'zip-bomb': {
      // 2 MiB의 0바이트 → deflate 후 수 KiB. 압축비가 한도를 자릿수로 넘긴다.
      // 중앙디렉터리 값만으로 판정되므로 실제 해제는 일어나지 않는다.
      const bomb = new Uint8Array(2 * 1024 * 1024);
      return buildZip([
        ...baseEntries(1, [synthSectionXml()]),
        { path: 'BinData/bomb.bin', data: bomb },
      ]);
    }

    case 'path-traversal':
      return buildZip([
        ...baseEntries(1, [synthSectionXml()]),
        { path: '../evil.xml', data: '<evil/>' },
      ]);

    case 'doctype-xxe': {
      const poisoned =
        `${XML_DECLARATION}<!DOCTYPE hs:sec [<!ENTITY xxe SYSTEM "file:///etc/passwd">]>` +
        synthSectionXml().slice(XML_DECLARATION.length);
      return buildZip(baseEntries(1, [poisoned]));
    }

    case 'missing-header':
      return buildZip(
        baseEntries(1, [synthSectionXml()]).filter((entry) => entry.path !== 'Contents/header.xml'),
      );

    case 'dangling-parapr':
      return buildZip(baseEntries(1, [synthSectionXml({ paraPrIdOverride: 999 })]));

    case 'duplicate-entry':
      return buildZip([
        ...baseEntries(1, [synthSectionXml()]),
        { path: 'settings.xml', data: SYNTH_SETTINGS_XML },
      ]);

    case 'flatten-only-object':
      return buildZip(baseEntries(1, [synthSectionXml({ withEquation: true })]));

    case 'multi-section':
      return buildZip(baseEntries(2, [synthSectionXml(), synthSectionXml({ withTable: false })]));

    case 'symlink-entry':
      // unix mode 0xA1FF(lrwxrwxrwx)를 상위 16비트에 둔다. 압축해제 시
      // 링크를 따라가게 만드는 고전적 탈출 경로다.
      return buildZip([
        ...baseEntries(1, [synthSectionXml()]),
        { path: 'BinData/link.bin', data: '../../etc/passwd', externalFileAttributes: 0xa1ff0000 },
      ]);

    case 'encrypted-entry':
      return buildZip([
        ...baseEntries(1, [synthSectionXml()]),
        { path: 'BinData/secret.bin', data: 'x', generalPurposeFlags: 0x0001 },
      ]);

    case 'data-descriptor':
      // flag 0x08은 크기·CRC가 로컬 헤더가 아니라 데이터 뒤에 있다는 뜻이라
      // "중앙디렉터리 값만 신뢰한다"는 원칙과 어긋난다.
      return buildZip([
        ...baseEntries(1, [synthSectionXml()]),
        { path: 'BinData/streamed.bin', data: 'x', generalPurposeFlags: 0x0008 },
      ]);

    case 'zip64-locator':
      return buildZip(baseEntries(1, [synthSectionXml()]), { appendZip64Locator: true });

    case 'zip64-entry-count':
      return buildZip(baseEntries(1, [synthSectionXml()]), { zip64EntryCountSentinel: true });

    case 'deep-xml-nesting':
      // 기본 한도 256보다 깊게. 파싱 도중 HWPX-1002로 거부되어야 한다.
      return buildZip(baseEntries(1, [synthDeeplyNestedSectionXml(300)]));

    case 'dangling-styleref':
      return buildZip(baseEntries(1, [synthSectionXml({ withDanglingStyleRef: true })]));

    case 'empty-table-cell':
      return buildZip(baseEntries(1, [synthSectionXml({ withEmptyTableCell: true })]));
  }
}

/** CORPUS.yaml 주석이 열거한 음성·희소 9종. 이 목록은 줄이지 않는다. */
export const CORPUS_DECLARED_SYNTH_FIXTURE_IDS: readonly SynthFixtureId[] = [
  'zip-signature-broken',
  'zip-bomb',
  'path-traversal',
  'doctype-xxe',
  'missing-header',
  'dangling-parapr',
  'duplicate-entry',
  'flatten-only-object',
  'multi-section',
];

export const SYNTH_FIXTURE_IDS: readonly SynthFixtureId[] = [
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
];
