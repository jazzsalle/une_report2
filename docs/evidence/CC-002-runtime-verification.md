# CC-002 런타임 검증 증거

- 일시: 2026-07-30 (회사 PC, 재부팅 후 세션)
- 브랜치: feature/CC-002 (b5e0e27 기준 + 리뷰 반영 수정)
- 실행 환경: Windows 11 + WSL2 Ubuntu 24.04 (커널 6.18.33.2-microsoft-standard-WSL2)
- Docker (원문 출력):
  - `Docker version 29.6.2, build dfc4efb`
  - `Docker Compose version v5.3.1`
  - WSL Ubuntu 내부, systemd 서비스 active

## 설치 경로 (승인 프로파일의 무료 경로)

infrastructure/README.md의 "WSL2 + Docker Engine CE (권장)" 절차를 그대로 사용.

1. `wsl --install -d Ubuntu` 후 Windows 재부팅 (이전 세션)
2. 재부팅 후 배포판 미등록 상태 확인 → `ubuntu.exe install --root`로 등록
3. README의 apt 절차로 docker-ce, docker-ce-cli, containerd.io, docker-compose-plugin 설치
4. systemd가 docker 서비스 자동 기동 (`systemctl is-active docker` → active)

## 수용 기준별 검증 결과

### 1. local services start — PASS

```
cd /mnt/d/vibecoding/report2/infrastructure
cp .env.example .env   # 로컬 전용 랜덤 비밀번호(openssl rand -hex 16) 주입
docker compose up -d
```

- une-postgres: Up (healthy)
- une-minio: Up (healthy)
- une-minio-init: Exited (0) — 로그에 `Bucket created successfully local/une-documents`

### 2. health checks — PASS

- `docker compose ps` 양 서비스 (healthy)
- `docker compose exec postgres pg_isready -U une -d une` → `accepting connections`
- `docker compose exec minio mc ready local` → `The cluster 'local' is ready`
- 호스트(Windows) 접근: `http://localhost:9000/minio/health/live` → 200,
  `http://localhost:9001` → 200, TCP 5432 → 연결 성공 (WSL2 포트 포워딩)

### 3. persistent volumes — PASS

절차: PG에 프로브 행 INSERT + MinIO에 프로브 오브젝트 업로드 →
`docker compose down`(컨테이너·네트워크 제거, 볼륨 유지) → `docker compose up -d --wait` →
재조회.

- PostgreSQL: `SELECT note FROM persistence_probe WHERE id = 1` → 기록값 반환 (컨테이너
  재생성 2회 + WSL VM 재시작 1회 이후에도 생존)
- MinIO: `mc cat probe/une-documents/probe.txt` → `cc-002-probe` 반환
- 검증 후 프로브 데이터 정리 완료 (DROP TABLE, mc rm)

### 4. no secrets in repo — PASS

- `infrastructure/.env`는 `git check-ignore` 확인됨 (gitignored)
- 저장소에는 빈 비밀번호의 `.env.example`만 존재
- 변경 파일 대상 secret 패턴 grep → 검출 0건
- compose는 `${VAR:?}` 필수 지정으로 비밀번호 누락 시 기동 거부

## 저장소 게이트 (feature/CC-002, 전체)

- `pnpm validate:handoff` → PASS (259 files)
- `pnpm validate:contracts` → PASS
- `pnpm build` / `pnpm typecheck` / `pnpm lint` / `pnpm format:check` → PASS
- `pnpm test` → 10/10 통과 (web 1, field-web 1, domain 4, hwpx-engine 2, api 1, worker 1)
- `docker compose config --quiet` → 유효 (interpolation 포함)

## 리뷰 게이트와 반영 수정 (같은 날)

이중 리뷰: architecture-guardian **CONDITIONAL PASS**, qa-gate-reviewer
**PASS WITH CONDITIONS** (수용 기준 4개를 리뷰어가 독립 재현으로 확인 —
볼륨 CreatedAt(19:05) < 컨테이너 재생성(19:08) 타임라인, 호스트 200/200/TCP OK,
전체 pnpm 게이트 재실행 일치).

필수 지적(M-1/M-2/M-3/M-4, C1/C2)을 당일 반영:

| 수정 | 내용 |
|---|---|
| M-4/C2 | `postgres:16.9-bookworm`(glibc, 데모 관리형 PG 패리티) + `POSTGRES_INITDB_ARGS`(ICU ko-KR, data-checksums) + `initdb/01-app-role.sh`로 비-superuser 앱 롤 `une_app` 생성 |
| M-2/C5 | 5432/9000/9001 기본 바인드 `127.0.0.1`(`UNE_BIND_ADDRESS`) |
| M-1/C3 | `minio-init.sh`: 버킷 한정 정책 `une-app` + 서비스 계정 생성(멱등). 서비스 `.env.example`에 스토리지 자격증명/region/path-style 키 추가, root는 사람 운영 전용 |
| C4 | infrastructure/README.md에 WSL 유휴 종료 함정, 범위 유예(AV 스캔/PgBouncer/버전관리/digest) 기록 |
| C1/M-3 | 이 증거 파일 커밋 + 상태 문서 4곳 동기화 |
| C5 | CI에 `docker compose config --quiet` 게이트 추가 |

## 반영 후 재검증 (볼륨 초기화 후 재기동)

initdb 변경 반영을 위해 `docker compose down -v` 후 재기동:

- `SELECT current_user, rolsuper, rolbypassrls` (une_app 접속) → `une_app|f|f`
- `pg_database`의 une: `datlocprovider=i`(ICU), `daticulocale=ko-KR`, `UTF8`
- une_app TCP 비밀번호 인증 → OK
- 서비스 계정: `une-documents` RW OK / `mc admin info` 거부 / 버킷 생성 거부
- `minio-init` 2회 연속 실행 → 둘 다 Exited(0) (멱등)
- `docker port`: 3개 포트 모두 `127.0.0.1`에만 바인드
- Windows 호스트: 9000 → 200, 9001 → 200, TCP 5432 → OK (WSL localhost 포워딩)
- `pg_isready` accepting connections / `mc ready local` ready
- `docker compose config --quiet` → 유효

## 참고 사항

- WSL2는 유휴 시 자동 종료되며, docker 서비스(systemd)와 `restart: unless-stopped`
  정책으로 다음 접근 시 컨테이너가 자동 복구됨을 확인함. 데이터는 명명 볼륨에 유지.
  단 Windows 쪽 소켓 접속만으로는 VM이 깨어나지 않는다(README 주의 참조).
- `docker compose up -d --wait`는 one-shot minio-init(Exited 0)와 함께 정상 종료(exit 0).
- MinIO 헬스체크 `mc ready local`은 비인증 liveness — 자격증명 준비 신호는
  minio-init Exited(0)으로 판단.
