import { authoredStableId, type StableIdKind } from '../ir/stable-id';

/**
 * 신규 노드 ID 발급기 (CC-150, ADR-30 D2; 설계 07 §1.10-2의 IR 층 선반영).
 *
 * ## 무엇을 고치는가
 *
 * CC-140의 `stableIdForAnchor('P', "Contents/section0.xml#p[17]")`는 앵커
 * 파생이다. 앵커에는 서수가 들어 있으므로 **문단을 하나 삽입하면 뒤의 모든
 * 앵커가 밀리고**, IR을 XML에서 다시 만들면 문서 전체 ID가 바뀐다. 그러면
 * 클라이언트가 들고 있던 selection anchor, Undo 스택의 대상 ID,
 * `document_block` 행이 한꺼번에 무효가 된다. 편집 층은 두 규칙으로 이 결함을
 * 닫는다:
 *
 *   1. **재빌드 금지** — 편집은 `document_revision.ir_json`을 로드해 트리를
 *      변형한다. 기존 노드 ID는 어떤 편집으로도 재계산되지 않는다(동결).
 *   2. **앵커 무관 발급** — 신규 ID는 (changeSetId, 연산 순서, 연산 내 일련번호)
 *      로만 결정된다. 난수·시각·전역 카운터를 쓰지 않으므로 같은 ChangeSet을
 *      같은 IR에 두 번 적용하면 같은 ID가 나온다(I1/I7 결정성 유지).
 *
 * ## 충돌은 조용히 넘기지 않는다
 *
 * §1.10-2는 "새 Para/Run/Table ID는 문서 전체 ID Index와 충돌하지 않도록
 * 발급"하라고 한다. 흔한 구현은 충돌하면 seq를 올려 다시 시도하는 것인데,
 * 여기서는 **오류로 끝낸다**. 이유:
 *
 *   - seq를 올려 재발급하면 같은 (changeSetId, opOrder, seq) 좌표가 서로 다른
 *     ID를 가리키게 되어 **결정성이 깨진다**. 같은 ChangeSet을 재적용했을 때
 *     같은 결과가 나온다는 보장이 사라지고, Undo가 다른 노드를 지운다.
 *   - SHA-256 20자리(80비트) 접두사가 충돌할 확률은 사실상 0이다. 실제로
 *     충돌이 관측된다면 그것은 우연이 아니라 **같은 changeSetId를 두 번 쓴
 *     버그**이거나 주입된 ID다. 조용한 재발급은 그 사실을 감춘다.
 */
export class AuthoredIdCollisionError extends Error {
  constructor(
    readonly id: string,
    readonly kind: StableIdKind,
    readonly opOrder: number,
    readonly seq: number,
  ) {
    super(
      `신규 노드 ID가 문서의 기존 ID와 충돌했습니다: ${id} ` +
        `(kind=${kind} opOrder=${opOrder} seq=${seq}). ` +
        'changeSetId가 재사용되었을 가능성이 큽니다 — 재발급하지 않고 중단합니다.',
    );
    this.name = 'AuthoredIdCollisionError';
  }
}

export class AuthoredIdIssuer {
  /** 이번 적용에서 이미 발급한 ID. 자기 자신과의 충돌도 잡는다. */
  private readonly issued = new Set<string>();
  /** (kind, opOrder)별 일련번호. 연산 내 순서가 곧 seq다. */
  private readonly counters = new Map<string, number>();

  /**
   * @param existingIds 문서 전체 ID 집합(`DocumentIndex.allIds`). 블록뿐 아니라
   *   섹션·행·셀·run ID까지 포함해야 한다 — 종류 접두사가 달라도 같은 해시
   *   공간을 쓰므로 좁은 집합으로 검사하면 검사를 안 한 것과 같다.
   */
  constructor(
    private readonly existingIds: ReadonlySet<string>,
    private readonly changeSetId: string,
  ) {}

  issue(kind: StableIdKind, opOrder: number): string {
    const key = `${kind}|${opOrder}`;
    const seq = this.counters.get(key) ?? 0;
    this.counters.set(key, seq + 1);
    const id = authoredStableId(kind, this.changeSetId, opOrder, seq);
    if (this.existingIds.has(id) || this.issued.has(id)) {
      throw new AuthoredIdCollisionError(id, kind, opOrder, seq);
    }
    this.issued.add(id);
    return id;
  }

  /** 이번 적용에서 발급된 ID 목록(진단·diff 용). */
  issuedIds(): readonly string[] {
    return [...this.issued];
  }
}
