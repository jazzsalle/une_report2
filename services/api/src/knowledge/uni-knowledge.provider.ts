import { createUniKnowledgeProvider, type UniKnowledgeProvider } from '@une/provider-adapters';
import type { Provider } from '@nestjs/common';

/**
 * UNI 지식문서 Provider 주입 토큰 (CC-230).
 *
 * CC-220은 워커에서만 UNI를 불렀으므로 API에 이 토큰이 필요 없었다.
 * CC-230의 근거 검색은 **동기**라(ADR-37 D2) API가 직접 부른다.
 *
 * `SITUATION_PROVIDERS`·`OBJECT_STORAGE`와 같은 형태다 — 토큰 하나, 팩토리
 * 하나, 설정은 여기서 한 번만 읽는다. 서비스가 구체 팩토리를 직접 부르면
 * 도메인이 포트가 아니라 구현에 붙고(.claude/rules/architecture.md) 테스트가
 * 대체할 방법이 없다.
 *
 * 팩토리가 `process.env`를 읽는다 — mock/실 어댑터 선택과 OB-13 미확인 값의
 * 기동 거부가 모두 거기 있다. 운영에서 mock을 쓰면 기동하지 않는다.
 */
export const UNI_KNOWLEDGE = Symbol('UNI_KNOWLEDGE');

export const uniKnowledgeFactory: Provider = {
  provide: UNI_KNOWLEDGE,
  useFactory: (): UniKnowledgeProvider => createUniKnowledgeProvider(process.env),
};
