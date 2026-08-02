# rhwp Upstream Record

repository: https://github.com/edwardkim/rhwp

## 정본은 PROVENANCE.yaml

반입 사실(tag, commit, 아카이브 URL/해시, 라이선스, SBOM, tree_digest, 승인자,
상태, POC Gate)의 **정본은 `PROVENANCE.yaml` 하나뿐**이다. 이 파일에 값을
중복 기재하지 않는다 — 두 곳에 적으면 반드시 어긋난다.

| 항목 | 위치 |
|---|---|
| 반입 기록(정본) | `PROVENANCE.yaml` (아직 없음 = 미반입) |
| 기록 형식 | `PROVENANCE.schema.json` (JSON Schema 2020-12) |
| 작성 템플릿 | `PROVENANCE_TEMPLATE.yaml` |
| 실행 절차·롤백 | `INTAKE_PROCEDURE.md` |
| 패치 매니페스트 | `patches/PATCHES.yaml` |
| 배포 고지 | `../THIRD_PARTY_NOTICES.md` (R8이 PROVENANCE.yaml과 대조) |
| 강제 게이트 | `pnpm validate:intake` → `scripts/validate-source-intake.mjs` |

## 현재 상태

**NOT_IMPORTED.** `PROVENANCE.yaml`이 없고 `upstream/`은 비어 있다. 이 상태가
게이트의 통과 상태다(R11, ADR-29 D1). 반입 실행은 사람의 명시적 승인 이후
`INTAKE_PROCEDURE.md`를 따른다.

## 디렉터리 규약

| 경로 | 용도 |
|---|---|
| `upstream/` | 반입한 원본 소스만. 직접 수정 금지(R5가 tree_digest로 감시) |
| `patches/` | 불가피한 수정의 유일한 경로. 사유·upstream issue·파일·회귀시험 필수(R7) |
| `sbom/` | SBOM 산출물(spdx-json 또는 cyclonedx-json). R9가 파싱·컴포넌트 확인 |

UNE 자체 로직은 `third_party/` 밖(`services/hwpx-engine/`, `packages/`)에 둔다
(ADR v1.1 §8.3, `.claude/rules/hwpx.md`).
