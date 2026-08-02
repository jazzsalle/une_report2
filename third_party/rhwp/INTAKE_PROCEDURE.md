# rhwp 소스 반입 절차 (실행 매뉴얼)

- 대상: `third_party/rhwp/upstream/`
- 근거: ADR v1.1 §8.3(반입 규칙)·§8.5(업스트림 관리)·§8.6(엔진 POC Gate), ADR-29 D1,
  `docs/external-dependencies/RHWP_SOURCE_INTAKE.md`
- 강제 게이트: `pnpm validate:intake` (`scripts/validate-source-intake.mjs`, 규칙 R1~R12)

## 0. 전제 — 아직 반입하지 않았다

현재 상태는 `status: NOT_IMPORTED` + 빈 `upstream/`이며 게이트는 이 상태에서
통과한다(R11). **아래 절차는 사람의 명시적 승인 이후에만 실행한다**(CLAUDE.md
Safety: 외부 아카이브 반입은 승인 필요). 승인 없이 명령을 실행하지 말 것.

### 상태 어휘 — 왜 두 단계인가

ADR v1.1 §8.3은 *"**POC Gate를 통과한** 특정 Tag 또는 Commit의 소스 아카이브를 …
반입한다"* 라고 명시한다. 반면 실무 순서는 "받아서 → 시험하고 → 반입"이다. 두
요구를 동시에 만족시키기 위해 상태를 나눈다.

| status | upstream/ | 의미 | 게이트 |
|---|---|---|---|
| `NOT_IMPORTED` | 비어 있음 | 아무것도 하지 않은 오늘 상태 | R11 그린 |
| `PROVENANCE_RECORDED` | **비어 있어야 함** | ref/아카이브 해시/라이선스는 확정했고 POC Gate는 저장소 **밖 작업 디렉터리**에서 수행 중 | R2b가 소스 배치를 막지 않음 |
| `IMPORTED` | 파일 있음 | 최소 집합 게이트 통과 후 실제 반입 | R2a·R12 적용 |
| `SUPERSEDED` | 파일 있음/없음 | 새 반입으로 대체된 이전 기록 | R10이 의존 코드 차단 |

- **R2는 양방향이다.** `upstream/`에 파일이 있는데 status가 `IMPORTED`/`SUPERSEDED`가
  아니면 실패한다. 트리에 들어온 소스는 배포물에 포함되므로 "미반입"이라고 적어
  둔 채로 배포 고지를 회피할 수 없다(§8.3 LICENSE/THIRD_PARTY 고지, §8.5).
- **R12는 최소 집합을 요구한다.** `IMPORTED`이면 `G15-1`(분석)과 `G15-6`(라이선스)이
  `PASS`여야 한다. `G15-2`~`G15-5`는 UNE 소유 계층(양식상속·편집·보존 저장·성능)이
  있어야 수행 가능하므로 `PENDING`을 허용하되 `FAIL`은 허용하지 않는다.

## 1. 선행 확인

- [ ] 승인자와 승인 근거(변경기록/ADR/이슈 경로)가 기록되어 있다.
- [ ] 반입할 tag 또는 commit이 확정되었다. `main`/`master`/`HEAD`/`latest`는 R4가 거부한다.
- [ ] 업스트림 라이선스가 `PROVENANCE.schema.json`의 `license` 허용목록에 있다.
      (copyleft 계열이면 여기서 멈추고 신규 ADR을 작성한다.)
- [ ] G15-1·G15-6을 수행할 HWPX 시료와 SBOM 도구가 준비되어 있다(R12 최소 집합).

## 2. 다운로드와 해시

```bash
TAG=v0.0.0                      # 확정된 tag로 교체
WORK=$(mktemp -d)               # 저장소 밖. 여기서 시험한다.
curl -fsSL -o "$WORK/rhwp-$TAG.tar.gz" \
  "https://github.com/edwardkim/rhwp/archive/refs/tags/$TAG.tar.gz"

# archive_sha256 (64-hex)
sha256sum "$WORK/rhwp-$TAG.tar.gz"

# 해석된 commit SHA (40-hex). tag 반입에서도 반드시 기록한다.
git ls-remote https://github.com/edwardkim/rhwp "refs/tags/$TAG^{}"
```

`archive_url`, `archive_filename`, `archive_sha256`, `commit`을 받아 적는다.
아카이브 파일 자체는 저장소에 커밋하지 않는다.

## 3. 압축 해제 — 저장소 밖에서

```bash
tar -xzf "$WORK/rhwp-$TAG.tar.gz" -C "$WORK"   # -> $WORK/rhwp-$TAG/
```

아직 `third_party/rhwp/upstream/`으로 옮기지 않는다. 옮기는 순간 R2b가
`status: IMPORTED`를 요구하고, R12가 G15-1·G15-6 `PASS`를 요구한다.

## 4. POC Gate 최소 집합 수행 (G15-1·G15-6) — 배치 전

작업 디렉터리의 소스로 수행한다. 결과와 증거 경로를 남긴다.

- **G15-1 분석**: 임의 HWPX 10종 이상에 대해 `AUTO`/`CONFIRM`/`LIMITED`/`REJECT`
  판정과 근거가 재현되는가. 이 ref를 고정할 근거 자체이며 UNE 계층 없이
  아카이브만으로 수행 가능하다.
- **G15-6 라이선스**: MIT/Third-party 고지, 금지 폰트 미포함, SBOM 생성.
  반입은 그 자체로 재배포이므로 배치 전에 확인해야 한다.

두 항목이 `PASS`가 아니면 **배치하지 않는다**. `FAIL`이면 다른 ref를 선정하거나
신규 ADR로 예외를 기록한다. G15-2~G15-5는 UNE 계층 구현 후 수행하며 이 시점에는
`PENDING`으로 남긴다.

증거는 `docs/evidence/<work-item>/` 아래에 두고 경로를 `poc_gate[*].evidence`에 적는다.

### SBOM 배치 (G15-6 산출물)

SBOM은 업스트림 원본이 아니라 UNE 산출물이므로 `sbom/` 아래에 **지금** 둔다.
`upstream/`을 건드리지 않으므로 R2b가 걸리지 않는다. 형식은 `spdx-json` 또는
`cyclonedx-json`이며, rhwp는 Rust + npm 혼합이라 두 생태계를 모두 다루는 도구를
쓴다(예시일 뿐, 도구 선택은 반입 시점에 확정한다).

```bash
# 예: CycloneDX
cyclonedx-npm --output-format json \
  --output-file third_party/rhwp/sbom/rhwp-$TAG.cdx.json
```

R9는 SBOM이 실제로 파싱되고 **rhwp 컴포넌트를 포함**하는지 확인한다. 빈 껍데기
파일은 통과하지 못한다.

### (선택) 중간 기록 — PROVENANCE_RECORDED

게이트 수행 중에 기록을 먼저 남기려면 `PROVENANCE.yaml`을
`status: PROVENANCE_RECORDED`로 작성한다. 이 상태는 게이트를 통과한다.

- `upstream/`은 비어 있어야 한다(R2b).
- `tree_digest`는 빈 트리 해시
  `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855`.
- `license_file`/`license_file_sha256`은 작업 디렉터리에서 측정한 값을 적는다.
  실측 대조(R5)는 배치 이후에 수행된다.
- `poc_gate`는 아직 `PENDING`이어도 된다(R12는 `IMPORTED`에만 적용).
- `THIRD_PARTY_NOTICES.md`의 Status도 `PROVENANCE_RECORDED`로 맞춘다(R8).

## 5. upstream/ 배치

```bash
rsync -a --delete "$WORK/rhwp-$TAG/" third_party/rhwp/upstream/
```

- `upstream/`는 **pristine**이다. 이 디렉터리 안의 파일을 직접 고치지 않는다.
  불가피한 수정은 `patches/PATCHES.yaml` 항목 + 패치 파일로만 추적한다(R7).
- `.git`/`.gitmodules`가 섞여 들어오면 R6가 거부한다. 압축 해제 산출물에
  포함되어 있으면 삭제한다.
- 심볼릭 링크는 R5가 거부한다. 발견 시 실파일로 대체하거나 반입 대상에서 제외한다.
- `upstream/.gitkeep`은 그대로 둔다(디렉터리 앵커, 해시 산정에서 제외됨).

배치한 뒤에는 `status: NOT_IMPORTED`/`PROVENANCE_RECORDED`로 둘 수 없다(R2b).
6~9단계를 끝내고 `IMPORTED`로 확정할 때까지가 한 번의 작업이다.

## 6. tree_digest 산정

```bash
node scripts/validate-source-intake.mjs --print-tree-digest
```

산정 정의는 `scripts/validate-source-intake.mjs` 헤더 주석에 있다(경로 정렬 →
`sha256  경로` 매니페스트 → 매니페스트의 sha256). POSIX 셸로도 재현 가능하다:

```bash
cd third_party/rhwp/upstream
find . -type f ! -name .gitkeep -printf '%P\0' | LC_ALL=C sort -z \
  | while IFS= read -r -d '' p; do \
      printf '%s  %s\n' "$(sha256sum "$p" | cut -d' ' -f1)" "$p"; done \
  | sha256sum
```

LICENSE 해시도 함께 받아 적는다:

```bash
sha256sum third_party/rhwp/upstream/LICENSE
```

## 7. PROVENANCE.yaml 작성

```bash
cp third_party/rhwp/PROVENANCE_TEMPLATE.yaml third_party/rhwp/PROVENANCE.yaml
```

모든 `OPEN`을 실제 값으로 교체한다. 하나라도 남으면 R3가 실패한다. 형식은
`PROVENANCE.schema.json`이 정본이며 템플릿 주석에 각 필드 예시가 있다.

- `status`: 소스가 실제로 `upstream/`에 있으므로 `IMPORTED`(R2).
- `poc_gate`: `G15-1`·`G15-6`은 4단계 결과인 `PASS` + 증거 경로(R12).
  `G15-2`~`G15-5`는 `PENDING` + 빈 evidence로 두고, UNE 계층 구현 후 갱신한다.
  (`PASS`/`FAIL`이면 evidence가 비어 있을 수 없다 — 스키마 제약.)

## 8. THIRD_PARTY_NOTICES.md 갱신

`third_party/THIRD_PARTY_NOTICES.md`의 rhwp 행을 PROVENANCE.yaml과 동기화한다.
R8이 다음을 대조한다.

| 열 | 대조 대상 |
|---|---|
| Upstream | `upstream_url`와 완전 일치 |
| Version/commit | `commit`(40-hex) 포함, `ref_type: tag`면 `tag`도 포함 |
| License | `license`와 완전 일치 |
| Archive SHA-256 | `archive_sha256` 포함 |
| Status | `status`와 완전 일치 |

R8은 "기록과 고지가 일치하는가"만 본다. "트리에 소스가 있는데 미반입이라고 적는"
회피 경로는 R2b가 막는다.

## 9. 게이트 실행

```bash
pnpm validate:intake
pnpm --filter @une/contract-tests test
```

`SOURCE INTAKE VALIDATION: PASS`가 나올 때까지 위 단계를 수정한다. 실패 메시지는
`R<번호>`로 시작하므로 어떤 규칙이 걸렸는지 바로 식별된다.

## 10. 반입 후 유지

- `upstream/` 직접 수정 금지. 수정은 `patches/PATCHES.yaml`에
  `id`/`reason`/`upstream_issue`/`files[]`/`tests[]`를 모두 채워 등재한다(R7).
- `G15-2`~`G15-5`는 해당 UNE 계층 구현 시 수행하고 `poc_gate`를 갱신한다.
  `FAIL`을 기록한 채로 `IMPORTED`를 유지할 수 없다(R12).
- 업스트림 갱신은 자동 merge 금지(§8.5). 새 tag 반입은 이 절차를 처음부터
  다시 수행하고 이전 기록은 `status: SUPERSEDED`로 남긴다.
- `docs/handoff/OPEN_BINDINGS.md` OB-12를 반입 증거(라이선스/SBOM/해시/POC 보고서)로 갱신한다.

## 11. 롤백

반입을 되돌려야 할 때(해시 불일치, 라이선스 재검토, 승인 철회 등):

```bash
# 1) 반입물 제거 — upstream/은 앵커만 남긴다
git rm -r --cached third_party/rhwp/upstream
rm -rf third_party/rhwp/upstream
mkdir -p third_party/rhwp/upstream && : > third_party/rhwp/upstream/.gitkeep

# 2) 기록 제거 (또는 status: SUPERSEDED로 보존)
rm -f third_party/rhwp/PROVENANCE.yaml

# 3) SBOM 산출물 제거
rm -f third_party/rhwp/sbom/*.json

# 4) 고지 원복: rhwp 행을 OPEN / OPEN / OPEN / NOT_IMPORTED 로
#    (편집 후) 게이트로 확인
pnpm validate:intake     # R11 그린 상태로 복귀했는지 확인
```

- 소스 제거와 status 되돌림은 **같은 변경**으로 처리한다. 파일만 남기고 status를
  내리거나 그 반대로 두면 R2가 실패한다.
- 커밋된 뒤의 롤백은 **되돌림 커밋**으로 하고 이력을 재작성하지 않는다
  (감사 이력 보존 원칙). 반입 이력 자체는 남기고 상태만 되돌린다.
- `packages/`·`services/`·`apps/`에 rhwp 의존 코드가 이미 들어갔다면 그 코드를
  먼저 제거해야 한다. 남아 있으면 R10이 롤백 후 상태를 실패로 잡는다.
