# 배포 런북 (CC-440)

이 문서는 **UNE가 소유한 부분**을 처음부터 세우고, 올리고, 되돌리는 절차다.
T3Q·UNI·한컴에 걸린 것은 각 절에서 "아직 못 하는 것"으로 표시했다.

> **이 런북으로 배포하면 안 되는 상태가 아직 있다.** §7의 차단 항목을 먼저
> 읽으십시오. 지금 통과하지 못하는 게이트가 둘이다(Track B, 실 provider 계약).

## 1. 무엇을 올리는가

| 구성요소 | 형태 | 비고 |
|---|---|---|
| `apps/web` | 정적 번들 | Vercel (데모), 운영은 미정 (OB-14) |
| `apps/field-web` | 정적 번들 | 현장 임무 UI |
| `services/api` | 컨테이너 | **Vercel serverless 금지** — 승인 프로필 |
| `services/worker` | 컨테이너 | 잡·아웃박스·보존 스윕 |
| `services/hwpx-engine` | API/워커에 라이브러리로 포함 | 별도 프로세스 아님 |
| PostgreSQL 16+ | 관리형 또는 컨테이너 | 마이그레이션 50개 |
| S3 호환 저장소 | MinIO/S3 | 버킷 하나 |

## 2. 사전 준비 — 순서가 중요하다

### 2.1 데이터베이스 롤

**initdb가 마이그레이션보다 먼저 돈다.** 그래서 두 단계로 갈린다.

1. `infrastructure/initdb/01-app-role.sh` — `une_app`(런타임, RLS 적용)
2. `infrastructure/initdb/02-worker-role.sh` — `une_worker_app`(워커 로그인)
3. 마이그레이션 `0050` — `une_worker_app`에 `une_worker`·`une_retention`
   멤버십을 `INHERIT FALSE, SET TRUE`로 준다

관리형 PostgreSQL에서 initdb 스크립트를 쓸 수 없으면 **같은 SQL을 손으로**
돌린다. 0050은 롤이 없으면 NOLOGIN으로 만들어 멤버십만 주므로, 그 뒤에
`ALTER ROLE une_worker_app LOGIN PASSWORD '…'`만 하면 된다.

> `une_app`에 `une_worker`/`une_retention` 멤버십을 주지 마십시오. 기본
> `INHERIT`가 정책 대상 자격까지 물려줘 **API가 전 테넌트의 provider 원문을
> 보게 됩니다**(ADR-35 D2/D4, ADR-47 D3).

### 2.2 환경변수

`infrastructure/.env.example`, `services/api/.env.example`,
`services/worker/.env.example`가 정본이다. 값이 없으면 **기동을 거부하는 것이
정상 동작**이다 — 추측 기본값을 넣지 않았다.

특히:

- `UNE_DB_WORKER_PASSWORD` — 없으면 compose가 거부한다.
- `UNE_T3Q_*`, `UNE_UNI_*` — mock이 아닌 어댑터를 고르면 전 필드가 필수다.
- `UNE_ALLOW_MOCK_PROVIDER` — **운영에서 mock을 쓰려면 명시해야 한다.**
  그 값이 켜져 있다는 사실 자체가 "실 provider 지원이 아니다"의 기록이다.
- `UNE_KNOWLEDGE_ALLOW_SCAN_PENDING` — AV가 없는 동안 지식문서 등록을 여는
  완화(OB-15). 켜져 있으면 **검사하지 않은 파일이 UNI로 올라간다.**

### 2.3 객체 저장소

버킷 하나. 서비스 계정은 **그 버킷으로 스코프**한다(루트 자격증명 금지).
`infrastructure/minio-init.sh`가 로컬에서 하는 일과 같다.

## 3. 배포 순서

```
1. 마이그레이션          pnpm run db:migrate      (앞으로만; 되돌리지 않는다)
2. 워커 배포             무중단 아님 — 잡은 임차 기반이라 재시작에 안전하다
3. API 배포              /health/ready 가 ready 가 될 때까지 트래픽 차단
4. 프런트 배포           API 배포 후
```

**마이그레이션 먼저**인 이유: 새 코드가 옛 스키마에서 도는 것보다 옛 코드가
새 스키마에서 도는 편이 안전하다. 이 저장소의 마이그레이션은 전방 전용이고
컬럼을 지우지 않는다.

## 4. 준비 확인

| 확인 | 방법 | 통과 기준 |
|---|---|---|
| API 살아 있음 | `GET /api/v1/health/live` | `status: ok` |
| API 준비됨 | `GET /api/v1/health/ready` | `status: ready`, 두 점검 모두 `ok` |
| 메트릭 | `GET /api/v1/metrics` | `une_http_requests_total` 존재 |
| 마이그레이션 | `SELECT count(*) FROM pgmigrations` | **50** |
| 롤 | `SELECT pg_has_role('une_worker_app','une_worker','SET')` | `t` |
| 격리 | `SELECT pg_has_role('une_app','une_retention','SET')` | **`f`** |

`/health/ready`가 `degraded`면 `checks[].error`에 사유가 있다. 로드밸런서는
`ready`가 아닌 인스턴스에 트래픽을 보내면 안 된다.

## 5. 되돌리기 — 전방 수정이 기본이다

이 저장소는 **마이그레이션을 되돌리지 않는다.** 스키마 문제는 새 마이그레이션
으로 고친다. 이유는 단순하다: 되돌리는 마이그레이션은 거의 시험되지 않고,
장애 중에 처음 시험된다.

| 상황 | 조치 |
|---|---|
| 새 코드에 결함 | **애플리케이션만** 이전 이미지로 되돌린다. 스키마는 전방 전용이라 옛 코드가 새 스키마에서 돈다 |
| 스키마에 결함 | 전방 수정 마이그레이션을 새로 만든다. 0027·0046이 그 전례다 |
| 데이터 손상 | §6 복구 |
| 워커가 42501로 죽는다 | 롤 멤버십이 없다(§2.1). 0050을 적용했는지 확인 |
| 훈련이 실제 문자를 보냈다 | `sop_run.mode`를 확인. 0047 이후로는 EXERCISE 상황에 LIVE 실행이 서지 않는다 |

## 6. 백업과 복구

```bash
# 훈련(덤프 → 빈 DB 복구 → 원본 대조 → RTO 기록)
pnpm run db:backup-drill -- --out drill.json

# 서버와 도구 버전이 다르면 시작 전에 멈춘다. 컨테이너 도구를 쓰려면:
pnpm run db:backup-drill -- --docker une-postgres --wsl Ubuntu
```

- **도구와 서버의 주버전이 같아야 한다.** 새 클라이언트가 서버가 모르는 설정을
  덤프에 넣으면 복구가 첫 줄에서 죽는다(실측).
- 대조는 행 수만이 아니라 RLS·정책·트리거·인덱스·제약·마이그레이션 수를 본다.
- **롤은 덤프에 없다.** 다른 서버로 복구할 때는 §2.1이 먼저 서야 한다.
- **오브젝트 저장소는 이 훈련의 대상이 아니다.** 문서 산출물이 DB 밖에 있으므로
  복구본은 메타데이터만 온전하다(ADR-48 수용 한계 3).

측정된 RTO: **22.28초**(거의 빈 DB 기준 — 실 데이터량에서 다시 재야 한다).

## 7. 지금 배포를 막는 것

| 항목 | 내용 |
|---|---|
| **OB-15** | AV 엔진 없음. `scan_status`가 영구 PENDING이라 지식문서 등록에 완화 토글이 필요하다. 켠 채로 배포하면 **검사하지 않은 파일이 UNI로 올라간다** |
| **OB-01** | T3Q 계약 미수용. 계획서 생성은 mock이거나 미검증 HTTP다 |
| **OB-13** | UNI multipart 필드명·토큰 필드명 미확인. 실 UNI 호출이 한 번도 성공한 적 없다 |
| **OB-08** | 한컴 Track B 미실시. HWPX 왕복 릴리스 게이트가 열려 있다 |
| **OB-14** | 최종 인도 환경 미확정. 트레이스 수집기도 여기에 딸려 있다 |
| **OB-06** | 실 채널 계약 없음. 전파는 SYSTEM 외 전부 시뮬레이션이다 |

**mock을 실 지원으로 보고하지 마십시오.** capability 레지스트리가 상태를 따로
들고 있고, 그것이 정본이다.

## 8. 아직 이 런북에 없는 것

- 무중단 배포(블루/그린) 절차 — 인도 환경 확정 후
- 스케일아웃 시 아웃박스 릴레이 중복 방지 — 지금은 단일 워커 전제
- 트레이스 수집기 배선 (ADR-48 수용 한계 1)
- 오브젝트 저장소 백업 (ADR-48 수용 한계 3)
- 부하·동시성 시험 (ADR-48 수용 한계 4)
