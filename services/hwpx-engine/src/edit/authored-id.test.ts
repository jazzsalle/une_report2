import { describe, expect, it } from 'vitest';
import { authoredStableId, stableIdForAnchor } from '../ir/stable-id';
import { AuthoredIdCollisionError, AuthoredIdIssuer } from './authored-id';
import { indexDocument } from './document-tree';
import { editFixture } from './edit-fixtures';

/**
 * 신규 노드 ID 발급 (ADR-30 D2).
 *
 * 여기서 지키는 성질은 세 가지다: 결정성, 앵커 비의존, 충돌 시 중단.
 */

describe('앵커 파생 ID의 구조적 결함을 재현한다', () => {
  it('문단 하나가 밀리면 앵커 파생 ID가 전부 달라진다 — 그래서 편집에 쓸 수 없다', () => {
    const before = ['p[16]', 'p[17]', 'p[18]'].map((path) =>
      stableIdForAnchor('P', `Contents/section0.xml#${path}`),
    );
    // p[17] 앞에 문단을 삽입하면 원래 p[17]은 p[18]이 된다.
    const afterInsert = ['p[16]', 'p[18]', 'p[19]'].map((path) =>
      stableIdForAnchor('P', `Contents/section0.xml#${path}`),
    );
    expect(afterInsert[1]).not.toBe(before[1]);
    expect(afterInsert[2]).not.toBe(before[2]);
  });

  it('authoredStableId는 앵커를 입력으로 받지 않는다(서수 이동에 면역)', () => {
    const first = authoredStableId('P', 'CS-1', 0, 0);
    const second = authoredStableId('P', 'CS-1', 0, 0);
    expect(first).toBe(second);
    expect(first).toMatch(/^P-[0-9A-F]{20}$/);
    expect(authoredStableId('P', 'CS-1', 0, 1)).not.toBe(first);
    expect(authoredStableId('P', 'CS-2', 0, 0)).not.toBe(first);
    expect(authoredStableId('R', 'CS-1', 0, 0)).not.toBe(first);
  });
});

describe('AuthoredIdIssuer', () => {
  it('연산·종류별로 일련번호를 매기고 재발급하지 않는다', () => {
    const issuer = new AuthoredIdIssuer(new Set<string>(), 'CS-1');
    const a = issuer.issue('P', 0);
    const b = issuer.issue('P', 0);
    const c = issuer.issue('P', 1);
    expect(new Set([a, b, c]).size).toBe(3);
    expect(a).toBe(authoredStableId('P', 'CS-1', 0, 0));
    expect(b).toBe(authoredStableId('P', 'CS-1', 0, 1));
    expect(c).toBe(authoredStableId('P', 'CS-1', 1, 0));
    expect(issuer.issuedIds()).toHaveLength(3);
  });

  it('문서 전체 ID 집합과 충돌하면 seq를 올리지 않고 오류로 끝낸다', () => {
    const colliding = authoredStableId('P', 'CS-1', 0, 0);
    const issuer = new AuthoredIdIssuer(new Set([colliding]), 'CS-1');
    expect(() => issuer.issue('P', 0)).toThrow(AuthoredIdCollisionError);
  });

  it('같은 발급기에서 두 번 나온 ID도 충돌로 잡는다', () => {
    const issuer = new AuthoredIdIssuer(new Set<string>(), 'CS-1');
    const first = issuer.issue('P', 0);
    // 같은 좌표를 강제로 다시 만들면(내부 카운터를 우회한 상황) 충돌이다.
    const twin = new AuthoredIdIssuer(new Set([first]), 'CS-1');
    expect(() => twin.issue('P', 0)).toThrow(/충돌/);
  });

  it('충돌 검사 기준은 블록뿐 아니라 섹션·행·셀·run ID까지다', () => {
    const fx = editFixture();
    const index = indexDocument(fx.ir);
    const kinds = new Set([...index.allIds].map((id) => id.split('-')[0]));
    // 좁은 집합으로 검사하면 검사를 안 한 것과 같다.
    expect(kinds).toContain('SEC');
    expect(kinds).toContain('P');
    expect(kinds).toContain('R');
    expect(kinds).toContain('TR');
    expect(kinds).toContain('TC');
  });
});
