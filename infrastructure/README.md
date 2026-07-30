# Local Infrastructure (CC-002)

PostgreSQL 16과 MinIO(S3 호환)를 Docker Compose로 기동하는 로컬 개발 의존성이다.
비밀값은 저장소에 없으며 `infrastructure/.env`에서만 주입한다.

## 사전 요구: Docker 런타임 (무료 경로)

승인된 프로파일(TECHNOLOGY_PROFILE.md)의 무료 경로 중 하나를 설치한다.
Docker Desktop은 라이선스 조건 때문에 기본 경로가 아니다.

| 경로 | 설치 | 비고 |
|---|---|---|
| WSL2 + Docker Engine CE (권장) | 관리자 PowerShell에서 `wsl --install -d Ubuntu` 후 재부팅, Ubuntu 안에서 Docker CE 설치 | 가장 가볍고 완전 무료 |
| Rancher Desktop | https://rancherdesktop.io 설치 관리자 | GUI 포함, dockerd(moby) 모드 선택 |
| Podman Desktop | https://podman-desktop.io | `podman compose` 사용, docker 별칭 제공 |

WSL2 + Docker Engine CE 상세 (Ubuntu 내부):

```bash
sudo apt-get update
sudo apt-get install -y ca-certificates curl
sudo install -m 0755 -d /etc/apt/keyrings
sudo curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] \
  https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo $VERSION_CODENAME) stable" \
  | sudo tee /etc/apt/sources.list.d/docker.list > /dev/null
sudo apt-get update
sudo apt-get install -y docker-ce docker-ce-cli containerd.io docker-compose-plugin
sudo usermod -aG docker $USER   # 이후 셸 재시작
```

WSL2 안에서 이 저장소는 `/mnt/d/vibecoding/report2`로 접근한다.

> **WSL 유휴 종료 주의**: WSL2 VM은 유휴 시 자동 종료되며, Windows 쪽에서
> `localhost:5432/9000`으로 소켓을 여는 것만으로는 VM이 깨어나지 않는다
> (connection refused). 먼저 `wsl -d Ubuntu -- docker compose ps` 같은 명령으로
> VM을 깨우면 systemd가 docker를 올리고 `restart: unless-stopped` 정책으로
> 컨테이너가 자동 복구된다.

## 기동

```bash
cd infrastructure
cp .env.example .env    # 비밀값 4개 설정 (필수): UNE_DB_PASSWORD,
                        # UNE_DB_APP_PASSWORD, UNE_MINIO_ROOT_PASSWORD,
                        # UNE_STORAGE_ACCESS_KEY/UNE_STORAGE_SECRET_KEY
docker compose up -d
docker compose ps       # postgres/minio가 healthy 인지 확인
```

`minio-init`는 버킷(`UNE_MINIO_BUCKET`, 기본 `une-documents`)과 버킷 한정
정책(`une-app`) + 서비스 계정(`UNE_STORAGE_ACCESS_KEY`)을 만들고 종료하는
일회성 멱등 컨테이너다(Exited(0)이 정상).

## 접속 주체 (최소권한)

| 주체 | 용도 | 비고 |
|---|---|---|
| PG `une` (superuser) | 마이그레이션·운영 작업 전용 | RLS를 우회하므로 런타임 금지 |
| PG `une_app` | services/api·worker 런타임 | NOSUPERUSER/NOBYPASSRLS — RLS 강제. 첫 initdb에서 생성 |
| MinIO root (`une-minio`) | 콘솔·부트스트랩 등 사람 운영 전용 | 서비스 설정에 넣지 않는다 |
| MinIO `UNE_STORAGE_ACCESS_KEY` | services/api·worker 런타임 | `une-documents` 버킷 한정 정책 |

- `POSTGRES_INITDB_ARGS`(ICU ko-KR 콜레이션)와 `initdb/01-app-role.sh`는 **첫
  initdb에만** 적용된다. 변경하려면 `docker compose down -v`로 볼륨 초기화 필요.
- 이미지는 Debian(bookworm) 계열로 고정한다 — 데모 관리형 PostgreSQL(glibc)과
  콜레이션·쿼리 플랜 패리티 유지 목적. alpine으로 되돌리지 말 것.
- CC-004(마이그레이션)는 `FORCE ROW LEVEL SECURITY` 적용과 함께 RLS 테스트를
  `une_app` 롤로 수행해야 한다(소유자/superuser는 RLS를 우회하므로).

## 검증

```bash
# PostgreSQL 헬스체크
docker compose exec postgres pg_isready -U une -d une

# MinIO 헬스체크 (컨테이너 내부 mc; 비인증 liveness라 자격증명 오류는 못 잡는다.
# 버킷·서비스 계정 준비 신호는 minio-init의 Exited(0)으로 판단)
docker compose exec minio mc ready local

# 호스트에서 접근 확인
# PostgreSQL: localhost:5432 / MinIO S3 API: http://localhost:9000
# MinIO 콘솔: http://localhost:9001 (루트 계정은 .env 값)
```

## 중지/초기화

```bash
docker compose down          # 컨테이너만 중지·제거 (데이터 유지)
docker compose down -v       # 명명된 볼륨까지 삭제 (데이터 초기화, 주의)
```

데이터는 명명된 볼륨 `une_pgdata`, `une_minio_data`에 영속화된다.

## 범위 노트 (CC-002 이후 항목)

- **AV 스캔**: 설계(10_API_DB_SEQUENCE §업로드)의 malware scan 의존성은 파일
  업로드 항목(CC-140/CC-220)에서 ScanPort 로컬 스텁으로 추가한다. 이 compose에
  스캐너 컨테이너가 없는 것은 기록된 유예다.
- **PgBouncer**: 설계 스택의 커넥션 풀러는 로컬 개발 규모에서 불필요해 생략.
  부하·배포 검증 항목에서 재평가한다.
- **버킷 버전관리**: 로컬 MinIO에 버전관리를 켜지 않았다. 불변 산출물(스냅샷
  근거, export 결과, raw payload)의 불변성은 애플리케이션 계층의 write-once 키
  규칙으로 보장하며, 스토리지 포트 구현 항목에서 버전관리 필요성을 재평가한다.
- **이미지 고정**: 태그 고정(digest 미고정). 태그를 올릴 때는 이 README와
  증거 문서를 함께 갱신하고 `docker compose config --quiet` + 기동 검증을 다시
  수행한다.

## 배포와의 관계

이 compose는 **로컬 개발 전용**이며 배포 방식을 제약하지 않는다.
배포 구조(TECHNOLOGY_PROFILE.md Deployment constraints, OB-14):

| 구성요소 | 로컬 개발 | 배포 (데모) |
|---|---|---|
| apps/web, apps/field-web | `pnpm dev` | **Vercel** (정적 빌드만) |
| services/api, services/worker | 로컬 Node | **Railway 컨테이너** (2026-07-30 확정) |
| PostgreSQL | 이 compose | 관리형 PostgreSQL (Railway Postgres 후보) |
| 객체 저장소 | 이 compose의 MinIO | S3 호환 스토어 (storage port 뒤라 교체만) |

- 백엔드는 Vercel serverless에 올리지 않는다 — 장기 실행 워커, outbox 폴링,
  SSE, 장시간 HWPX 작업이 serverless와 맞지 않는다.
- Vercel 프론트 ↔ Railway 백엔드 연결은 `VITE_API_BASE_URL`(프론트)과
  CORS 허용(백엔드)으로 구성한다.
- 최종 납품 환경은 OB-14로 OPEN 유지.

## 서비스 연결값

`services/api/.env`와 `services/worker/.env`의 예시 형태:

```
DATABASE_URL=postgres://une_app:<UNE_DB_APP_PASSWORD>@localhost:5432/une
OBJECT_STORAGE_ENDPOINT=http://localhost:9000
OBJECT_STORAGE_ACCESS_KEY=<UNE_STORAGE_ACCESS_KEY>
OBJECT_STORAGE_SECRET_KEY=<UNE_STORAGE_SECRET_KEY>
```

런타임은 항상 `une_app`(PG)과 버킷 한정 서비스 계정(MinIO)을 사용한다.
superuser·root 자격증명은 서비스 `.env`에 넣지 않는다.
