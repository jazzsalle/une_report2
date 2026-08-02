import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { sha256Bytes } from '../package/zip-reader';

/**
 * `tests/hwpx/corpus/CORPUS.yaml` 로더 (ADR-29 D8).
 *
 * **파일명이 아니라 sha256으로 해석한다.** 실 파일명이 한글이라 NFC/NFD 정규화와
 * 플랫폼 인코딩 차이에 노출되기 때문이다(Windows에서 만든 파일명을 macOS에서
 * 읽으면 같은 글자가 다른 바이트열이 된다). 로더는 `dir`을 스캔해 각 파일의
 * 해시를 계산하고 매니페스트 항목과 맞춘다. 그래서 파일 이름이 바뀌어도,
 * 정규화 형태가 달라도 코퍼스는 그대로 해석된다.
 *
 * ## YAML 파싱 방식
 *
 * 최소 파싱이다. 워크스페이스 패키지에 `yaml` 의존을 추가하지 않기 위해서이며
 * (엔진의 런타임 의존은 `@une/domain` 하나로 유지한다), 대상 문서가 2단계
 * 들여쓰기의 스칼라/리스트만 쓰는 고정 형식이기 때문이다. 형식이 조금이라도
 * 벗어나면 조용히 무시하지 않고 **예외를 던진다** — 조용한 스킵은 "코퍼스가
 * 비어 있는데 테스트가 통과"하는 최악의 결과를 만든다.
 */

export interface CorpusFile {
  readonly alias: string;
  readonly sha256: string;
  readonly bytes: number;
  readonly tags: readonly string[];
  readonly expectedVerdict: string;
  /** 실측 confidence. 골든표와 교차 고정한다(리뷰 B-1). */
  readonly measuredConfidence: number;
  /** 그 판정이 나온 이유(상한 유발 객체 또는 밴드 판정). */
  readonly capReason: string;
  /** 해시로 매칭된 실제 경로. */
  readonly path: string;
}

export interface CorpusManifest {
  readonly version: number;
  readonly dir: string;
  readonly files: readonly CorpusFile[];
}

interface ManifestEntry {
  alias?: string;
  sha256?: string;
  bytes?: number;
  tags?: string[];
  expectedVerdict?: string;
  measuredConfidence?: number;
  capReason?: string;
}

function stripComment(line: string): string {
  const hash = line.indexOf('#');
  if (hash < 0) return line;
  return line.slice(0, hash);
}

function parseScalar(raw: string): string {
  const value = raw.trim();
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }
  return value;
}

function parseInlineList(raw: string): string[] {
  const value = raw.trim();
  if (!value.startsWith('[') || !value.endsWith(']')) {
    throw new Error(`CORPUS.yaml: 인라인 리스트 형식이 아닙니다: ${raw}`);
  }
  const inner = value.slice(1, -1).trim();
  if (inner === '') return [];
  return inner.split(',').map((item) => parseScalar(item));
}

export function parseCorpusManifest(text: string): {
  version: number;
  dir: string;
  entries: ManifestEntry[];
} {
  let version = 0;
  let dir = '';
  const entries: ManifestEntry[] = [];
  let current: ManifestEntry | null = null;
  let inFiles = false;

  for (const rawLine of text.split(/\r?\n/)) {
    const line = stripComment(rawLine);
    if (line.trim() === '') continue;

    if (/^version:/.test(line)) {
      version = Number(parseScalar(line.slice('version:'.length)));
      continue;
    }
    if (/^dir:/.test(line)) {
      dir = parseScalar(line.slice('dir:'.length));
      continue;
    }
    if (/^files:/.test(line)) {
      inFiles = true;
      continue;
    }
    if (!inFiles) continue;

    const itemMatch = /^\s+-\s+(\S+):\s*(.*)$/.exec(line);
    if (itemMatch) {
      current = {};
      entries.push(current);
      assign(current, itemMatch[1], itemMatch[2]);
      continue;
    }
    const fieldMatch = /^\s+(\S+):\s*(.*)$/.exec(line);
    if (fieldMatch && current) {
      assign(current, fieldMatch[1], fieldMatch[2]);
      continue;
    }
    throw new Error(`CORPUS.yaml: 해석할 수 없는 줄입니다: ${rawLine}`);
  }

  return { version, dir, entries };
}

function assign(entry: ManifestEntry, key: string, raw: string): void {
  switch (key) {
    case 'alias':
      entry.alias = parseScalar(raw);
      return;
    case 'sha256':
      entry.sha256 = parseScalar(raw);
      return;
    case 'bytes':
      entry.bytes = Number(parseScalar(raw));
      return;
    case 'tags':
      entry.tags = parseInlineList(raw);
      return;
    case 'expectedVerdict':
      entry.expectedVerdict = parseScalar(raw);
      return;
    case 'measuredConfidence':
      entry.measuredConfidence = Number(parseScalar(raw));
      return;
    case 'capReason':
      entry.capReason = parseScalar(raw);
      return;
    default:
      throw new Error(`CORPUS.yaml: 알 수 없는 키 '${key}'`);
  }
}

/**
 * 매니페스트를 읽고 `dir`의 파일을 해시로 매칭한다.
 * @param repoRoot 저장소 루트 절대경로.
 */
export function loadCorpus(repoRoot: string): CorpusManifest {
  const manifestPath = resolve(repoRoot, 'tests/hwpx/corpus/CORPUS.yaml');
  const parsed = parseCorpusManifest(readFileSync(manifestPath, 'utf8'));
  const corpusDir = resolve(repoRoot, parsed.dir);

  const byHash = new Map<string, string>();
  for (const name of readdirSync(corpusDir)) {
    const path = join(corpusDir, name);
    let bytes: Buffer;
    try {
      bytes = readFileSync(path);
    } catch {
      continue; // 디렉터리 등은 건너뛴다.
    }
    byHash.set(sha256Bytes(bytes), path);
  }

  const files: CorpusFile[] = parsed.entries.map((entry) => {
    if (!entry.alias || !entry.sha256) {
      throw new Error(`CORPUS.yaml: alias/sha256이 없는 항목이 있습니다`);
    }
    const path = byHash.get(entry.sha256);
    if (!path) {
      throw new Error(
        `CORPUS.yaml: sha256 ${entry.sha256} (alias=${entry.alias})에 해당하는 파일이 ${parsed.dir}에 없습니다`,
      );
    }
    return {
      alias: entry.alias,
      sha256: entry.sha256,
      bytes: entry.bytes ?? 0,
      tags: entry.tags ?? [],
      expectedVerdict: entry.expectedVerdict ?? 'PENDING_MEASUREMENT',
      measuredConfidence: entry.measuredConfidence ?? Number.NaN,
      capReason: entry.capReason ?? '',
      path,
    };
  });

  return { version: parsed.version, dir: parsed.dir, files };
}

export function readCorpusFile(file: CorpusFile): Uint8Array {
  const bytes = readFileSync(file.path);
  const actual = sha256Bytes(bytes);
  if (actual !== file.sha256) {
    throw new Error(`코퍼스 파일 해시가 매니페스트와 다릅니다: ${file.alias}`);
  }
  return new Uint8Array(bytes);
}
