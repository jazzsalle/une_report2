-- Initial tenant and system permissions. Replace IDs by deployment bootstrap tooling.
INSERT INTO permission(permission_id, permission_code, resource_type, action, description)
VALUES
  (gen_random_uuid(),'PLAN_CREATE','PLAN','CREATE','계획서 생성'),
  (gen_random_uuid(),'PLAN_EDIT','PLAN','EDIT','계획서 편집'),
  (gen_random_uuid(),'PLAN_GENERATE','PLAN','GENERATE','T3Q 목차·본문 생성'),
  (gen_random_uuid(),'DOC_EDIT','DOCUMENT','EDIT','rhwp 문서 편집'),
  (gen_random_uuid(),'SITUATION_CREATE','SITUATION','CREATE','상황·훈련 등록'),
  (gen_random_uuid(),'SITUATION_CONFIRM','SITUATION','CONFIRM','SituationSnapshot 확정'),
  (gen_random_uuid(),'SOP_EDIT','SOP','EDIT','SOP 편집'),
  (gen_random_uuid(),'SOP_APPROVE','SOP','APPROVE','SOP 승인'),
  (gen_random_uuid(),'SOP_RUN','SOP','RUN','SOP 실행'),
  (gen_random_uuid(),'TASK_ASSIGNEE','TASK','REPORT','현장 임무 수행·보고'),
  (gen_random_uuid(),'JOURNAL_CREATE','JOURNAL','CREATE','상황일지 Projection'),
  (gen_random_uuid(),'ADMIN_ACCESS','ADMIN','MANAGE','시스템 관리')
ON CONFLICT (permission_code) DO NOTHING;
