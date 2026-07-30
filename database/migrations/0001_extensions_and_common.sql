-- UNE 재난안전 AI 문서 통합플랫폼 PostgreSQL 16+ 초기화

-- 이 기준선은 빈 스키마 전용이다. 수작업으로 일부 프로비저닝된 DB에 적용하면
-- IF NOT EXISTS 때문에 결함 수정이 조용히 누락되므로 즉시 실패시킨다 (ADR-21).
DO $$
BEGIN
  IF to_regclass('public.tenant') IS NOT NULL THEN
    RAISE EXCEPTION 'baseline must be applied to an empty schema: table "tenant" already exists without migration history';
  END IF;
END
$$;

CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS citext;

CREATE OR REPLACE FUNCTION une_set_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION une_current_tenant_id()
RETURNS uuid LANGUAGE sql STABLE AS $$
  SELECT NULLIF(current_setting('app.tenant_id', true), '')::uuid;
$$;
