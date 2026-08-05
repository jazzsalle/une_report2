import type { JSX } from 'react';
import { SliceWorkspace } from './slice/SliceWorkspace';

/**
 * 운영 워크스페이스.
 *
 * CC-170 시점에 여기 있는 것은 **계획서 수직 슬라이스 하나**다(로그인 →
 * 계획서 → 기준정보 → HWPX 반입 → 목차·본문 생성 → Export·다운로드).
 * 문서 편집기와 상황·SOP 화면은 각 항목에서 붙는다.
 */
export function App(): JSX.Element {
  return <SliceWorkspace />;
}
