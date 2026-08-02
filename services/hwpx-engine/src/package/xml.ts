/**
 * 네임스페이스 인식 XML 리더 (설계 07 §1.4-3).
 *
 * ## 파서 선택 근거 (무의존 자체 pull 파서)
 *
 * 후보는 `saxes`(ISC) 추가와 자체 구현 둘이었다. 자체 구현을 택한 이유:
 *
 * 1. **공급망**: HWPX는 신뢰할 수 없는 사용자 업로드가 최초로 닿는 표면이다.
 *    ADR v1.1 §8.5가 "악성 ZIP/XML, npm/cargo checksum 검증"을 요구하는
 *    자리에 의존을 하나 더 얹는 것은 방향이 반대다. 현재 엔진의 런타임
 *    의존은 `@une/domain`(워크스페이스) 하나뿐이고 그 상태를 유지한다.
 * 2. **거부가 기본이어야 함**: 범용 파서는 DTD/엔터티를 "옵션으로 끄는"
 *    모델이다. 옵션이 있다는 것은 켤 수 있다는 뜻이고, 실수 한 줄이 XXE가
 *    된다. 여기서는 DTD·외부 엔터티를 **문법적으로 표현 불가능**하게 둔다.
 * 3. **입력 형태가 좁다**: HWPX XML은 한/글이 기계 생성한 것으로 CDATA·처리
 *    명령·주석이 사실상 없고, 엔터티는 미리 정의된 5종 + 숫자 참조뿐이다.
 *    실 코퍼스 6종으로 이 전제를 회귀 검증한다.
 *
 * 즉 신규 npm 의존은 **없다**.
 *
 * ## 방어
 *
 * - `<!DOCTYPE` **선행 바이트 스캔**으로 무조건 거부한다. 파서 설정에
 *   의존하지 않는 층을 하나 더 두는 것이 목적이다(설정은 리팩터링에
 *   지워지지만 바이트 스캔은 남는다).
 * - `<!ENTITY`, 정의되지 않은 `&name;`, 외부 참조를 전부 거부한다.
 */
import { HwpxImportError } from './errors';
import { DEFAULT_HWPX_LIMITS, type HwpxLimits } from './limits';

export const HWPX_NAMESPACES: Readonly<Record<string, string>> = Object.freeze({
  ha: 'http://www.hancom.co.kr/hwpml/2011/app',
  hp: 'http://www.hancom.co.kr/hwpml/2011/paragraph',
  hp10: 'http://www.hancom.co.kr/hwpml/2016/paragraph',
  hs: 'http://www.hancom.co.kr/hwpml/2011/section',
  hc: 'http://www.hancom.co.kr/hwpml/2011/core',
  hh: 'http://www.hancom.co.kr/hwpml/2011/head',
  hhs: 'http://www.hancom.co.kr/hwpml/2011/history',
  hm: 'http://www.hancom.co.kr/hwpml/2011/master-page',
  hv: 'http://www.hancom.co.kr/hwpml/2011/version',
  hpf: 'http://www.hancom.co.kr/schema/2011/hpf',
  hwpunitchar: 'http://www.hancom.co.kr/hwpml/2016/HwpUnitChar',
  ooxmlchart: 'http://www.hancom.co.kr/hwpml/2016/ooxmlchart',
  opf: 'http://www.idpf.org/2007/opf/',
  ocf: 'urn:oasis:names:tc:opendocument:xmlns:container',
  dc: 'http://purl.org/dc/elements/1.1/',
  epub: 'http://www.idpf.org/2007/ops',
  config: 'urn:oasis:names:tc:opendocument:xmlns:config:1.0',
});

/** HWPX가 사용하는 것으로 알려진 네임스페이스 URI 집합(미지 판별용). */
export const KNOWN_NAMESPACE_URIS: ReadonlySet<string> = new Set(Object.values(HWPX_NAMESPACES));

export interface XmlElement {
  /** 원문에 쓰인 정규화되지 않은 이름 (예: 'hp:p'). */
  readonly qName: string;
  readonly prefix: string;
  readonly localName: string;
  /** 해석된 네임스페이스 URI. 선언이 없으면 null. */
  readonly namespaceUri: string | null;
  /** 정규화되지 않은 속성 맵(qName → 값). 미지 속성도 그대로 남는다. */
  readonly attributes: Readonly<Record<string, string>>;
  readonly children: readonly XmlNode[];
  /**
   * 같은 **localName** 형제 중 1-base 서수. 앵커의 `[n]`.
   *
   * 네임스페이스는 서수에 넣지 않는다(구현이 그렇고, 그것이 의도다).
   * `anchors.ts`의 `resolveAnchor`도 localName만으로 역참조하므로 두 층이
   * 같은 규칙을 쓴다. HWPX 한 Part 안에서 같은 localName이 서로 다른
   * 네임스페이스로 섞여 나오는 경우가 없어 모호성이 생기지 않으며, 규칙을
   * 바꾸면 이미 발급된 앵커의 의미가 달라져 I2·I7이 통째로 흔들린다.
   */
  readonly ordinal: number;
  readonly parent: XmlElement | null;
  /** 이 요소가 속한 Part 경로. 앵커 발급의 좌변. */
  readonly partPath: string;
}

export interface XmlText {
  readonly kind: 'text';
  readonly value: string;
}

export type XmlNode = XmlElement | XmlText;

export function isElement(node: XmlNode): node is XmlElement {
  return (node as XmlElement).localName !== undefined;
}

export function elementsOf(element: XmlElement): XmlElement[] {
  return element.children.filter(isElement);
}

/** 자손 포함 텍스트 노드만 이어붙인 문자열. 요소는 건너뛴다. */
export function textOf(element: XmlElement): string {
  let out = '';
  for (const child of element.children) {
    out += isElement(child) ? textOf(child) : child.value;
  }
  return out;
}

/** 직계 자식 중 첫 번째 localName 일치 요소. */
export function firstChild(element: XmlElement, localName: string): XmlElement | null {
  for (const child of element.children) {
    if (isElement(child) && child.localName === localName) return child;
  }
  return null;
}

export function childrenNamed(element: XmlElement, localName: string): XmlElement[] {
  return elementsOf(element).filter((child) => child.localName === localName);
}

/** 자손 전체를 문서 순서로 순회한다. */
export function* walk(element: XmlElement): Generator<XmlElement> {
  yield element;
  for (const child of element.children) {
    if (isElement(child)) yield* walk(child);
  }
}

const PREDEFINED_ENTITIES: Readonly<Record<string, string>> = Object.freeze({
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
});

const DOCTYPE_SIGNATURE = '<!DOCTYPE';
const ENTITY_SIGNATURE = '<!ENTITY';

function fail(partPath: string, detail: string): never {
  throw new HwpxImportError('HWPX-1001', partPath, detail);
}

/** 구조 자체는 정상이나 **한도**를 넘은 경우. ZIP 층의 1002와 같은 코드다. */
function failLimit(partPath: string, detail: string): never {
  throw new HwpxImportError('HWPX-1002', partPath, detail);
}

/**
 * 파싱 전 바이트 스캔. XML 선언 인코딩과 무관하게 ASCII 시그니처를 찾는다.
 * 주석 안의 `<!DOCTYPE` 문자열까지 거부하는 과탐이 있으나, 정상 HWPX에는
 * 주석 자체가 없고 "거부가 기본"이 이 층의 목적이다.
 */
export function assertNoDoctype(partPath: string, bytes: Uint8Array): void {
  const haystack = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  for (const signature of [DOCTYPE_SIGNATURE, ENTITY_SIGNATURE]) {
    if (haystack.includes(signature, 0, 'latin1')) {
      fail(partPath, `${signature} 선언이 있습니다 (DTD/외부 엔터티 거부)`);
    }
  }
}

function decodeEntities(partPath: string, raw: string): string {
  if (!raw.includes('&')) return raw;
  let out = '';
  let i = 0;
  while (i < raw.length) {
    const ch = raw[i];
    if (ch !== '&') {
      out += ch;
      i += 1;
      continue;
    }
    const end = raw.indexOf(';', i + 1);
    if (end < 0 || end - i > 12) fail(partPath, '종결되지 않은 엔터티 참조');
    const name = raw.slice(i + 1, end);
    if (name.startsWith('#')) {
      const codePoint = name.startsWith('#x')
        ? Number.parseInt(name.slice(2), 16)
        : Number.parseInt(name.slice(1), 10);
      if (!Number.isFinite(codePoint) || codePoint < 0 || codePoint > 0x10ffff) {
        fail(partPath, `잘못된 숫자 문자 참조 &${name};`);
      }
      out += String.fromCodePoint(codePoint);
    } else {
      const replacement = PREDEFINED_ENTITIES[name];
      if (replacement === undefined) {
        fail(partPath, `정의되지 않은 엔터티 참조 &${name}; (외부 엔터티 해석 금지)`);
      }
      out += replacement;
    }
    i = end + 1;
  }
  return out;
}

interface MutableElement {
  qName: string;
  prefix: string;
  localName: string;
  namespaceUri: string | null;
  attributes: Record<string, string>;
  children: XmlNode[];
  ordinal: number;
  parent: XmlElement | null;
  partPath: string;
}

const NAME_START = /[A-Za-z_:]/;
const NAME_CHAR = /[-A-Za-z0-9_:.]/;

/**
 * XML 문서를 파싱해 루트 요소를 돌려준다. Part 경로는 앵커 발급에 쓰이므로
 * 요소마다 함께 심는다.
 *
 * 깊이·요소 수 한도는 `limits`에서 온다(§1.4-2). 넘으면 HWPX-1002로 거부한다
 * — 후속 단계의 재귀 순회가 `RangeError`로 죽는 것을 막기 위해서다.
 */
export function parseXml(
  partPath: string,
  bytes: Uint8Array,
  limits: HwpxLimits = DEFAULT_HWPX_LIMITS,
): XmlElement {
  assertNoDoctype(partPath, bytes);
  const text = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).toString('utf8');

  let i = 0;
  let root: MutableElement | null = null;
  let elementCount = 0;
  const stack: MutableElement[] = [];
  // 스택 각 층의 네임스페이스 선언(prefix → uri). 상속은 조회 시 역방향 탐색.
  const nsStack: Array<Record<string, string>> = [];

  const resolveNs = (prefix: string): string | null => {
    for (let level = nsStack.length - 1; level >= 0; level -= 1) {
      const uri = nsStack[level][prefix];
      if (uri !== undefined) return uri;
    }
    return null;
  };

  const readName = (): string => {
    const start = i;
    if (i >= text.length || !NAME_START.test(text[i])) fail(partPath, '잘못된 XML 이름');
    i += 1;
    while (i < text.length && NAME_CHAR.test(text[i])) i += 1;
    return text.slice(start, i);
  };

  const skipSpace = (): void => {
    while (
      i < text.length &&
      (text[i] === ' ' || text[i] === '\t' || text[i] === '\n' || text[i] === '\r')
    ) {
      i += 1;
    }
  };

  while (i < text.length) {
    const lt = text.indexOf('<', i);
    if (lt < 0) break;
    if (lt > i) {
      const raw = text.slice(i, lt);
      const parent = stack[stack.length - 1];
      if (parent) parent.children.push({ kind: 'text', value: decodeEntities(partPath, raw) });
      i = lt;
    }

    if (text.startsWith('<?', i)) {
      const end = text.indexOf('?>', i);
      if (end < 0) fail(partPath, '종결되지 않은 처리 명령');
      i = end + 2;
      continue;
    }
    if (text.startsWith('<!--', i)) {
      const end = text.indexOf('-->', i);
      if (end < 0) fail(partPath, '종결되지 않은 주석');
      i = end + 3;
      continue;
    }
    if (text.startsWith('<![CDATA[', i)) {
      const end = text.indexOf(']]>', i);
      if (end < 0) fail(partPath, '종결되지 않은 CDATA');
      const parent = stack[stack.length - 1];
      if (parent) parent.children.push({ kind: 'text', value: text.slice(i + 9, end) });
      i = end + 3;
      continue;
    }
    if (text.startsWith('<!', i)) fail(partPath, '선언(<!...)은 허용하지 않습니다');

    if (text.startsWith('</', i)) {
      i += 2;
      const name = readName();
      skipSpace();
      if (text[i] !== '>') fail(partPath, '종료 태그가 올바르지 않습니다');
      i += 1;
      const open = stack.pop();
      nsStack.pop();
      if (!open || open.qName !== name) fail(partPath, `태그 짝이 맞지 않습니다 (</${name}>)`);
      continue;
    }

    // 시작 태그
    i += 1;
    const qName = readName();
    const attributes: Record<string, string> = {};
    const declarations: Record<string, string> = {};
    for (;;) {
      skipSpace();
      if (i >= text.length) fail(partPath, '종결되지 않은 시작 태그');
      if (text[i] === '>' || text.startsWith('/>', i)) break;
      const attrName = readName();
      skipSpace();
      if (text[i] !== '=') fail(partPath, `속성 ${attrName}에 값이 없습니다`);
      i += 1;
      skipSpace();
      const quote = text[i];
      if (quote !== '"' && quote !== "'") fail(partPath, `속성 ${attrName} 값에 따옴표가 없습니다`);
      i += 1;
      const close = text.indexOf(quote, i);
      if (close < 0) fail(partPath, `속성 ${attrName} 값이 종결되지 않았습니다`);
      const value = decodeEntities(partPath, text.slice(i, close));
      i = close + 1;
      if (attrName === 'xmlns') declarations[''] = value;
      else if (attrName.startsWith('xmlns:')) declarations[attrName.slice(6)] = value;
      else attributes[attrName] = value;
    }
    const selfClosing = text.startsWith('/>', i);
    i += selfClosing ? 2 : 1;

    elementCount += 1;
    if (elementCount > limits.maxElementCount) {
      failLimit(partPath, `XML 요소 수 한도 초과 (> ${limits.maxElementCount})`);
    }
    // stack.length는 아직 부모까지의 깊이다. 이 요소의 깊이는 +1.
    if (stack.length + 1 > limits.maxXmlDepth) {
      failLimit(
        partPath,
        `XML 중첩 깊이 한도 초과 (${stack.length + 1} > ${limits.maxXmlDepth}, ` + `요소 ${qName})`,
      );
    }

    nsStack.push(declarations);
    const colon = qName.indexOf(':');
    const prefix = colon < 0 ? '' : qName.slice(0, colon);
    const localName = colon < 0 ? qName : qName.slice(colon + 1);
    const parent = stack[stack.length - 1] ?? null;
    let ordinal = 1;
    if (parent) {
      for (const sibling of parent.children) {
        if (isElement(sibling) && sibling.localName === localName) ordinal += 1;
      }
    }
    const element: MutableElement = {
      qName,
      prefix,
      localName,
      namespaceUri: resolveNs(prefix),
      attributes,
      children: [],
      ordinal,
      parent: parent as XmlElement | null,
      partPath,
    };
    if (parent) parent.children.push(element as unknown as XmlElement);
    else if (root) fail(partPath, '루트 요소가 둘 이상입니다');
    else root = element;

    if (selfClosing) nsStack.pop();
    else stack.push(element);
  }

  if (stack.length > 0) fail(partPath, '닫히지 않은 요소가 있습니다');
  if (!root) fail(partPath, '루트 요소가 없습니다');
  return root as unknown as XmlElement;
}
