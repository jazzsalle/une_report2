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

## 기동

```bash
cd infrastructure
cp .env.example .env    # UNE_DB_PASSWORD, UNE_MINIO_ROOT_PASSWORD 설정 (필수)
docker compose up -d
docker compose ps       # postgres/minio가 healthy 인지 확인
```

`minio-init`는 `UNE_MINIO_BUCKET`(기본 `une-documents`) 버킷을 만들고 종료하는
일회성 컨테이너다(Exited(0)이 정상).

## 검증

```bash
# PostgreSQL 헬스체크
docker compose exec postgres pg_isready -U une -d une

# MinIO 헬스체크 (컨테이너 내부 mc)
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
DATABASE_URL=postgres://une:<UNE_DB_PASSWORD>@localhost:5432/une
OBJECT_STORAGE_ENDPOINT=http://localhost:9000
```
