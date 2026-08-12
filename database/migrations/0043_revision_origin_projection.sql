-- 0043 document_revision.origin에 PROJECTION을 더한다 (CC-300).
--
-- 왜 MATERIALIZE로 때우지 않는가.
--   0019 §3.3이 두 축을 갈라 놓았다: ChangeSet.origin은 "누가 요청했나",
--   document_revision.origin은 **"어떤 기제가 만들었나"**다. 상황일지의 첫
--   판을 만든 기제는 확정 판(SituationSnapshot)과 사실원장(Execution Log)에서
--   접은 **투영**이지, 생성물을 편집 가능한 문서로 옮기는 materialize가
--   아니다. 둘을 같은 값으로 적으면 "이 판이 왜 생겼는가"를 나중에 물었을 때
--   기획서 초안과 일지 투영이 한 덩어리로 나온다.
--
--   CC-300은 문장 단위에서도 출처를 숨기지 않는다
--   (journal_projection_item.narrative_source = PROJECTED/AI/USER, 0042 §2).
--   판 단위에서만 뭉뚱그리면 그 원칙이 한 층 위에서 깨진다.
--
--   0019 §3.3의 마지막 줄이 이 경우를 미리 적어 두었다 —
--   "어휘 확장이 필요해지면 전방 마이그레이션 한 줄이다."
--
-- 범위.
--   * document_revision.origin만 넓힌다. change_set.origin은 건드리지 않는다 —
--     투영은 ChangeSet을 거치지 않고(사람의 편집이 아니다) 판을 직접 만든다.
--   * 기존 행은 영향이 없다. CHECK를 넓히는 것뿐이라 재검증도 통과한다.
--   * 계약(RevisionOrigin)도 같은 변경에 함께 넓힌다 — OpenAPI와 구현을
--     따로 바꾸지 않는다(CLAUDE.md 개발 워크플로).

ALTER TABLE document_revision DROP CONSTRAINT ck_document_revision_origin;
ALTER TABLE document_revision ADD CONSTRAINT ck_document_revision_origin
  CHECK (origin IN ('IMPORT', 'MATERIALIZE', 'PROJECTION', 'CHANGESET',
                    'AUTOSAVE', 'UNDO', 'REDO', 'RESTORE'));

COMMENT ON COLUMN document_revision.origin IS
  '이 판을 만든 기제. IMPORT(파일 반입)/MATERIALIZE(생성물 편집본 전환)/'
  'PROJECTION(확정 판·사실원장 투영, CC-300)/CHANGESET(사람 편집)/'
  'AUTOSAVE/UNDO/REDO/RESTORE. ChangeSet.origin("누가 요청했나")과 축이 다르다(0019 §3.3).';
