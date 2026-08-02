/**
 * HWPX 반입 한도 (설계 07 §1.4-2, §1.12 "파일보안: 악성 ZIP/XML 차단").
 *
 * 값은 **상수**다. 환경변수로 완화할 수 있으면 한도가 아니라 권고가 되고,
 * 배포 환경마다 다른 판정이 나와 CC-140의 재현성(G15-1 "판정과 근거 재현")이
 * 깨진다. 테스트가 경계를 밟아야 할 때만 `readZipArchive(bytes, limits)`로
 * 명시 주입한다(합성 픽스처 전용, 운영 경로는 기본값 고정).
 *
 * 기준값 산정 근거는 실 코퍼스 6종 실측이다:
 *   - 엔트리 수 최대 13
 *   - 개별 압축해제 최대 203,034 B (BinData/image3.BMP)
 *   - 총 압축해제 최대 약 700 KiB (문서 템플릿_상황보고)
 *   - 압축비 최대 약 13.7:1 (Contents/header.xml 78,534/5,733)
 * 여유를 크게 두되 zip bomb(수백~수만:1)과는 자릿수로 분리되게 잡는다.
 */
export interface HwpxLimits {
  /** ZIP 중앙디렉터리 엔트리 수 상한. */
  readonly maxEntries: number;
  /** 엔트리 1개의 압축해제 크기 상한(바이트). */
  readonly maxEntryUncompressedBytes: number;
  /** 패키지 전체 압축해제 크기 합 상한(바이트). */
  readonly maxTotalUncompressedBytes: number;
  /** 압축해제/압축 비율 상한. 중앙디렉터리 값만으로 해제 전에 판정한다. */
  readonly maxCompressionRatio: number;
  /** 경로 세그먼트 깊이 상한('Contents/section0.xml' == 2). */
  readonly maxPathDepth: number;
  /** 엔트리 경로 문자열 길이 상한. */
  readonly maxPathLength: number;
  /** 패키지(아카이브) 자체 크기 상한(바이트). */
  readonly maxArchiveBytes: number;
  /**
   * XML 요소 중첩 깊이 상한(루트=1).
   *
   * 파서 자체는 반복문이라 깊이에 무너지지 않지만, 그 뒤의 `walk`·`textOf`·
   * `canonicalJson`은 재귀다. 한도가 없으면 깊은 중첩에서 `RangeError:
   * Maximum call stack size exceeded`가 터지는데, 그것은 `HwpxImportError`가
   * 아니라 호출자가 다룰 수 없는 형태다(리뷰 m-2). 반입 층에서 HWPX-1002로
   * 거부해 "거부 사유가 있는 오류"로 만든다.
   */
  readonly maxXmlDepth: number;
  /** XML Part 하나의 요소 개수 상한. 요소 폭발(billion laughs 변종) 방어. */
  readonly maxElementCount: number;
}

export const DEFAULT_HWPX_LIMITS: HwpxLimits = Object.freeze({
  maxEntries: 512,
  maxEntryUncompressedBytes: 64 * 1024 * 1024,
  maxTotalUncompressedBytes: 256 * 1024 * 1024,
  maxCompressionRatio: 200,
  maxPathDepth: 8,
  maxPathLength: 255,
  maxArchiveBytes: 128 * 1024 * 1024,
  // 실 코퍼스 6종 실측: 최대 중첩 깊이 28(brief-report-form, 중첩 표),
  // Part당 최대 요소 수 1,735(situation-report-template). 각각 약 9배·115배
  // 여유를 두되 재귀 붕괴·메모리 폭발과는 자릿수로 분리한다.
  maxXmlDepth: 256,
  maxElementCount: 200_000,
});

/** EOCD(End Of Central Directory) 역방향 탐색 범위. ZIP 주석 최대 길이 + 22. */
export const MAX_EOCD_SEARCH_BYTES = 0xffff + 22;
