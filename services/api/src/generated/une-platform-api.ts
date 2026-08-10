// GENERATED FILE - DO NOT EDIT.
// Regenerate with: pnpm generate:contract-types (source of truth: contracts/openapi).
/* eslint-disable */

export type paths = {
    "/auth/sso/exchange": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * T3Q SSO 토큰 교환
         * @description 권한: PUBLIC_SSO
         *
         *     핵심 요청: externalToken, returnUrl
         *
         *     핵심 응답: accessToken, refreshToken, userContext
         *
         *     오류: AUTH-1001~1004
         */
        post: operations["une_auth_001"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/auth/me": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * 현재 사용자·기관·역할 조회
         * @description 권한: AUTHENTICATED
         *
         *     핵심 요청: -
         *
         *     핵심 응답: UserContext
         *
         *     오류: AUTH-1005
         */
        get: operations["une_auth_002"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/auth/refresh": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Access Token 갱신
         * @description 권한: PUBLIC_REFRESH (ADR-22 D3: refresh 토큰 자체가 세션 보유 증명이며, 만료된 access token으로는 갱신할 수 없으므로 Bearer를 요구하지 않는다. 토큰의 tenant 세그먼트가 RLS 스코프를 열고 app_user 부모 조인이 위조를 차단한다. 사용 시 회전(rotation)되어 재사용/동시사용은 AUTH-1002.)
         *
         *     핵심 요청: refreshToken
         *
         *     핵심 응답: accessToken
         *
         *     오류: AUTH-1002
         */
        post: operations["une_auth_003"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/auth/logout": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * 세션 종료
         * @description 권한: AUTHENTICATED
         *
         *     핵심 요청: -
         *
         *     핵심 응답: 204
         *
         *     오류: AUTH-1006
         */
        post: operations["une_auth_004"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/organizations/tree": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * 조직도 조회
         * @description 권한: ORG_READ
         *
         *     핵심 요청: tenantId(optional)
         *
         *     핵심 응답: OrganizationTree
         *
         *     오류: ORG-2001
         */
        get: operations["une_auth_005"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/users": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * 사용자·담당자 검색
         * @description 권한: USER_READ
         *
         *     핵심 요청: orgId,keyword,status,page
         *
         *     핵심 응답: Page<UserSummary>
         *
         *     오류: USER-2101
         */
        get: operations["une_auth_006"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/roles": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * 역할·권한 조회
         * @description 권한: RBAC_READ
         *
         *     핵심 요청: scope
         *
         *     핵심 응답: Role[]
         *
         *     오류: RBAC-2201
         */
        get: operations["une_auth_007"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/home/summary": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * 통합 홈 요약
         * @description 권한: AUTHENTICATED
         *
         *     핵심 요청: -
         *
         *     핵심 응답: recentWorks,myTasks,health,alerts
         *
         *     오류: COM-0001
         */
        get: operations["une_home_001"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/notifications": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * 알림 목록
         * @description 권한: AUTHENTICATED
         *
         *     핵심 요청: filter,page
         *
         *     핵심 응답: Page<Notification>
         *
         *     오류: NOTI-3001
         */
        get: operations["une_home_002"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/notifications/{id}/read": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * 알림 읽음
         * @description 권한: AUTHENTICATED
         *
         *     핵심 요청: -
         *
         *     핵심 응답: Notification
         *
         *     오류: NOTI-3002
         */
        post: operations["une_home_003"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/notifications/read-all": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * 전체 읽음
         * @description 권한: AUTHENTICATED
         *
         *     핵심 요청: filter
         *
         *     핵심 응답: count
         *
         *     오류: NOTI-3003
         */
        post: operations["une_home_004"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/plans": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * 계획서 목록·검색
         * @description 권한: PLAN_READ
         *
         *     핵심 요청: keyword,status,hazardType,page
         *
         *     핵심 응답: Page<Plan>
         *
         *     오류: PLAN-4002
         */
        get: operations["une_plan_002"];
        put?: never;
        /**
         * 계획서 Workspace 생성
         * @description 권한: PLAN_CREATE
         *
         *     핵심 요청: title,startMode,hazardType,managementPhase(templateFileId는 CC-140까지 보류 — ADR-23 D3)
         *
         *     핵심 응답: Plan
         *
         *     오류: PLAN-4001
         */
        post: operations["une_plan_001"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/plans/{planId}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * 계획서 상세
         * @description 권한: PLAN_READ
         *
         *     핵심 요청: planId
         *
         *     핵심 응답: PlanDetail
         *
         *     오류: PLAN-4003
         */
        get: operations["une_plan_003"];
        put?: never;
        post?: never;
        /**
         * 계획서 휴지통 이동
         * @description 권한: PLAN_DELETE
         *
         *     핵심 요청: reason
         *
         *     핵심 응답: 204
         *
         *     오류: PLAN-403-001
         */
        delete: operations["une_plan_005"];
        options?: never;
        head?: never;
        /**
         * 계획서 메타 수정
         * @description 권한: PLAN_EDIT
         *
         *     핵심 요청: If-Match, JSON Merge Patch
         *
         *     핵심 응답: Plan
         *
         *     오류: PLAN-409-001
         *
         *     재시도 안전성은 If-Match 낙관잠금으로 보장(ADR-23 D1 개정)
         */
        patch: operations["une_plan_004"];
        trace?: never;
    };
    "/plans/{planId}/context-drafts": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * 기준정보 임시저장
         * @description 권한: PLAN_EDIT
         *
         *     핵심 요청: PlanContextDraft
         *
         *     핵심 응답: ContextDraft
         *
         *     오류: PLAN-422-001
         *
         *     단일 draft upsert(last-write-wins)로 자연 멱등 — 재생 저장소 제외(ADR-23 D1 개정)
         */
        post: operations["une_plan_006"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/plans/{planId}/context-snapshots": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * 기준정보 Snapshot 목록
         * @description 권한: PLAN_READ
         *
         *     핵심 요청: -
         *
         *     핵심 응답: Snapshot[]
         *
         *     오류: PLAN-404-002
         */
        get: operations["une_plan_008"];
        put?: never;
        /**
         * 기준정보 Snapshot 확정
         * @description 권한: PLAN_EDIT
         *
         *     핵심 요청: PlanContext
         *
         *     핵심 응답: PlanContextSnapshot
         *
         *     오류: PLAN-412-001
         */
        post: operations["une_plan_007"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/plans/{planId}/toc-jobs": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * T3Q RPT-001 목차 생성 Job
         * @description 권한: PLAN_GENERATE
         *
         *     핵심 요청: snapshotId,generationOption
         *
         *     핵심 응답: GenerationJob
         *
         *     오류: T3Q-502-001
         *
         *     본문 블록이 존재하면 412 PLAN-412-002(목차 재생성 차단 — 본문 블록의 nodeKey 앵커가 끊어지므로, 목차 변경 영향 Diff 흐름이 생기는 CC-170까지 막는다; ADR-27 D9).
         */
        post: operations["une_plan_009"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/plan-jobs/{jobId}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * 생성 Job 상태 조회
         * @description 권한: PLAN_READ
         *
         *     핵심 요청: jobId
         *
         *     핵심 응답: GenerationJob
         *
         *     오류: JOB-404-001
         */
        get: operations["une_plan_010"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/plan-jobs/{jobId}/events": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * 생성 Job SSE
         * @description 권한: PLAN_READ
         *
         *     핵심 요청: Last-Event-ID
         *
         *     핵심 응답: SSE<JobEvent>
         *
         *     오류: JOB-503-001
         */
        get: operations["une_plan_011"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/plan-jobs/{jobId}/cancel": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * 생성 Job 중지
         * @description 권한: PLAN_GENERATE
         *
         *     핵심 요청: reason
         *
         *     핵심 응답: GenerationJob
         *
         *     오류: JOB-409-001
         *
         *     취소는 계획서 상태를 ERROR로 보내지 않고 작업이 서 있는 자리로 되돌린다. TOC Job은 확정 목차 존재 여부로, CONTENT Job은 현재 본문 블록 존재 여부로 복귀 상태를 판정한다 (ADR-27 D3).
         */
        post: operations["une_plan_012"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/plan-jobs/{jobId}/retry": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * 실패 단위 재시도
         * @description 권한: PLAN_GENERATE
         *
         *     핵심 요청: blockIds,reason
         *
         *     핵심 응답: GenerationJob
         *
         *     오류: JOB-409-002
         *
         *     FAILED Job 전체를 다시 큐잉한다(TOC/CONTENT 공통). blockIds는 예약 필드이며 값이 오면 400 PLAN-4001이다 — 블록 단위 provider 재시도는 target-v2 partialRetry(CC-135), 범위 지정 재생성은 UNE-PLAN-016 targetNodeKeys다 (ADR-27 D7). attempt_no는 0으로 리셋되고 워커가 선점할 때 다시 증가한다.
         *
         *     재시도는 원 요청과 같은 전제조건을 다시 적용한다: 휴지통·결재 잠금 계획서는 412 PLAN-412-002, 같은 계획서에 활성 생성 Job이 있으면 409 PLAN-409-002, TOC Job 재시도인데 본문 블록이 존재하면 412 PLAN-412-002다(목차 재생성 차단 — CC-170, ADR-27 D9). FAILED가 아닌 상태는 409 JOB-409-002다.
         */
        post: operations["une_plan_013"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/plans/{planId}/toc-versions": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * 목차 편집 버전 저장
         * @description 권한: PLAN_EDIT
         *
         *     핵심 요청: baseVersionId,tocTree
         *
         *     핵심 응답: TocVersion
         *
         *     오류: TOC-409-001
         *
         *     본문 블록이 존재하면 412 PLAN-412-002(목차 변경 차단). 저장된 본문 블록은 목차 nodeKey에 앵커되어 있어 목차를 바꾸면 앵커가 끊어지므로, 목차 변경 영향 Diff 흐름이 생기는 CC-170까지 저장·확정을 모두 막는다 (ADR-27 D9).
         */
        post: operations["une_plan_014"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/plans/{planId}/toc-versions/{id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * 목차 버전 조회
         * @description 권한: PLAN_READ
         *
         *     핵심 요청: id
         *
         *     핵심 응답: TocVersion
         *
         *     오류: TOC-404-001
         */
        get: operations["une_plan_015"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/plans/{planId}/content-jobs": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * T3Q RPT-002 본문 생성 Job
         * @description 권한: PLAN_GENERATE
         *
         *     핵심 요청: contextSnapshotId,tocVersionId,targetNodeKeys,protectedBlockIds
         *
         *     핵심 응답: GenerationJob (jobType=CONTENT)
         *
         *     오류: T3Q-502-002
         *
         *     확정 PlanContextSnapshot과 목차 버전을 입력으로 CONTENT 생성 Job을 큐잉한다. 202는 큐잉 성공만을 뜻하며 본문 산출물은 워커가 만든다. 진행 상황은 UNE-PLAN-010(상태)과 UNE-PLAN-011(SSE content.block/job.progress)로 관측한다.
         *
         *     전제조건: contextSnapshotId는 계획서의 현재 확정 스냅샷이어야 하고 (아니면 400 PLAN-4001, 확정 스냅샷 자체가 없으면 412 PLAN-412-001), tocVersionId는 같은 계획서의 확정(CONFIRMED) 목차 버전이어야 한다 (계획서 불일치·미존재는 404 TOC-404-001, 목차 미확정 등 상태 전제조건 위반은 412 PLAN-412-002).
         *
         *     동시성: 같은 계획서에 활성(QUEUED/RUNNING/CANCEL_REQUESTED) 생성 Job이 있으면 409 PLAN-409-002로 거절한다. 이 조건은 job 타입과 무관하다 (TOC/CONTENT 어느 쪽이 진행 중이어도 새 생성 Job을 받지 않는다). 진행 중이라 계획서 상태가 CONTENT_GENERATING인 경우도 412가 아니라 409로 답한다 — 상태 전제조건보다 활성 Job 판정을 먼저 적용한다.
         *
         *     재생성 범위: targetNodeKeys를 지정하면 해당 노드 subtree만 재생성하고 나머지 블록은 보존한다. protectedBlockIds로 지정한 사용자 편집 블록은 protection_state=USER_LOCKED로 영속 기록되어 이후 모든 재생성에서 덮어쓰지 않는다 (알 수 없는 blockId는 422 PLAN-422-002).
         *
         *     Idempotency-Key는 필수다 (누락 428 COM-0428, 같은 키 다른 본문 409 COM-0409). T3Q-502-002(provider 오류)는 워커 실행 구간에서만 발생하므로 이 요청의 응답 코드가 아니라 job_event/error에 기록된다.
         */
        post: operations["une_plan_016"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/files": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * 파일 사전등록·업로드 URL 발급
         * @description 권한: FILE_UPLOAD
         *
         *     핵심 요청: fileName,size,mimeType,sha256
         *
         *     핵심 응답: FileObject+uploadUrl
         *
         *     오류: FILE-422-001
         *
         *     3단 업로드(설계 10 §2 "사전등록→직접 업로드→완료확정")의 1단이다. 서버는 `file_object` 행을 `uploadState=PENDING`으로 만들고 **바이트가 놓일 자리**와 그 자리에 쓸 티켓만 돌려준다. 바이트는 이 API를 지나가지 않는다.
         *
         *     선언값은 아직 사실이 아니다. `sha256`·`sizeBytes`는 클라이언트의 주장이며 UNE-DOC-002가 **저장된 바이트에서 다시 계산해** 대조한다. 그래서 저장 키에는 선언 해시를 쓰지 않고 `fileId`로 격리한다(ADR-32) — 검증되지 않은 바이트가 내용 주소 키를 차지하면 "키가 곧 내용"이라는 전제가 깨진다.
         *
         *     `upload.driver`는 진단·증거용이다. 클라이언트는 `url`/`method`/`headers`만 쓰고 driver로 분기하지 않는다. presign이 불가능한 드라이버(로컬·테스트의 인메모리 저장소)에서는 API 자신의 전송 라우트를 가리킨다.
         *
         *     멱등: Idempotency-Key. 같은 키 재전송은 **처음 발급한 응답을 그대로** 돌려준다(공통 멱등 저장소의 재생). 티켓에는 만료가 있으므로, 만료 뒤에 재시도하려면 **새 멱등 키로 다시 등록**해야 한다 — 앞의 행은 PENDING으로 남고 정리 대상이 된다.
         */
        post: operations["une_doc_001"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/files/{fileId}/complete": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * 업로드 완료·검사
         * @description 권한: FILE_UPLOAD
         *
         *     핵심 요청: etag
         *
         *     핵심 응답: FileObject
         *
         *     오류: FILE-422-002
         *
         *     3단 업로드의 3단이며 **검증 지점**이다. 서버는 저장된 객체를 읽어 (1) 크기, (2) SHA-256 재계산값, (3) **내용 기반 형식**을 사전등록 선언과 대조한다. 하나라도 어긋나면 422 FILE-422-002이고 행은 `uploadState=ABORTED`로 끝난다 — 이후 어떤 경로도 이 파일을 쓸 수 없다.
         *
         *     형식 판정은 확장자·`Content-Type`을 신뢰하지 않는다(`.claude/rules/security.md`). HWPX는 ZIP 매직과 `mimetype` 엔트리(`application/hwp+zip`)를 실제 바이트에서 확인한다. `etag`는 전송 계층이 준 값이며 **참고**로만 기록한다: 멀티파트 업로드의 ETag는 MD5가 아니고, 드라이버마다 다르므로 이것을 무결성 근거로 쓸 수 없다. 근거는 우리가 다시 계산한 SHA-256이다.
         *
         *     `scanStatus`는 이 단계에서도 PENDING이다. AV 스캐너는 아직 없다(OB-15) — 상태를 CLEAN으로 올리면 검사하지 않은 파일이 감사에서 검사된 것으로 보인다. `malware_scan` 테이블도 만들지 않았으므로 x-db-tables에 적지 않는다(ADR-32).
         *
         *     멱등: 같은 파일에 대한 재확정은 이미 VERIFIED인 행을 그대로 돌려준다. ABORTED 행의 재확정은 다시 422다(재조회로 고쳐지지 않는다).
         */
        post: operations["une_doc_002"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/files/{fileId}/content": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        /**
         * 업로드 전송(presign 불가 드라이버 전용)
         * @description `Authorization` 헤더를 쓰지 않는다 — UNE-DOC-001이 발급한 **서명 티켓
         *     토큰**(`upload.url`의 쿼리)만으로 인가한다. presign URL이 그렇게 동작하기
         *     때문이며, 두 드라이버가 같은 클라이언트 코드로 동작해야 하기 때문이다.
         *
         *     토큰은 fileId·테넌트·만료·선언 크기에 묶인다. 만료 후에는 403이고,
         *     이미 확정(VERIFIED/ABORTED)된 파일에는 409다. 여기서는 바이트를 저장만
         *     하며 **검증은 하지 않는다** — 검증 지점은 UNE-DOC-002 하나뿐이어야 한다.
         */
        put: operations["une_doc_001_transport"];
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/documents/import-hwpx": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * HWPX 업로드·분석
         * @description 권한: PLAN_CREATE
         *
         *     핵심 요청: fileId,planId
         *
         *     핵심 응답: Document+AnalysisJob
         *
         *     오류: HWPX-422-001
         *
         *     분석은 **동기**다. 설계의 "Document+AnalysisJob"에서 Job 형태를 취하지 않는 이유는 측정 결과다 — 실문서 6종 분석이 수십 ms이고(CC-140), Job으로 만들면 상태 폴링·리스·재시도를 관리할 대상이 하나 늘어나는 대신 사용자가 기다리는 시간은 같다. 이 결정과 되돌릴 조건(대용량에서 목표 초과)은 ADR-32에 적었다. 응답의 `analysis`가 곧 결과이며 UNE-DOC-004로 다시 읽는다.
         *
         *     전제: `fileId`는 UNE-DOC-002를 통과한(`uploadState=VERIFIED`) 파일이어야 한다. PENDING/ABORTED면 422 HWPX-422-001이다 — 검증되지 않은 바이트를 문서로 만들면 그 뒤의 모든 무결성 주장이 근거를 잃는다.
         *
         *     `planId`를 주면 **`plan.document_id`**에 이 문서가 기록된다. 그 컬럼은 0003부터 있었으나 쓰는 코드가 없어 항상 NULL이었다(CC-170이 채운다). 역방향 링크(`document.plan_id`)는 만들지 않는다 — 같은 관계에 진실을 둘 두면 갈라진다(ADR-32 D9). 이미 문서를 가진 계획서는 409, 다른 테넌트· 삭제된 계획서는 404다.
         *
         *     판정: 분석 결과 `verdict=REJECT`인 문서도 **가져온다**. 문서는 만들되 저장(Export)을 차단하는 것이 ADR-29 D11/ADR-31 D7의 집행 지점이므로, 반입 단계에서 문서를 만들지 않으면 사용자는 왜 거부됐는지 볼 화면이 없다. `analysis.verdict`와 `analysis.unsupportedObjects`가 그 근거다.
         *
         *     멱등: Idempotency-Key. 같은 키 재전송은 처음 만든 문서를 그대로 돌려준다 (같은 파일을 다시 반입하면 **새 문서**가 된다 — 파일 재사용은 반입 중복이 아니다).
         */
        post: operations["une_doc_003"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/documents/{documentId}/analysis": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * HWPX 분석결과 조회
         * @description 권한: DOC_READ
         *
         *     핵심 요청: -
         *
         *     핵심 응답: TemplateProfile,Warnings
         *
         *     오류: HWPX-404-001
         *
         *     요약(`analysis`)과 **전체 프로파일**(`profile`)을 함께 낸다. 전체 형태의 정본은 `contracts/schemas/template-profile.schema.json`이며 여기서는 `additionalProperties: true`로 통과시킨다 — 같은 어휘를 두 벌로 적으면 반드시 갈라진다(UNE-DOC-006이 change-set 스키마를 다루는 방식과 같다).
         *
         *     `unsupportedObjects`는 NATIVE_EDIT가 아닌 객체의 분류 결과이며, 어떤 것이 Export를 차단하는지(REJECT/FLATTEN_EXPORT_ONLY)를 화면이 판단하는 근거다. 분석 이력이 없는 문서는 404 HWPX-404-001이다.
         */
        get: operations["une_doc_004"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/documents/{documentId}/ir": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Document IR 조회
         * @description 권한: DOC_READ
         *
         *     핵심 요청: revisionId
         *
         *     핵심 응답: DocumentIR
         *
         *     오류: DOC-404-001
         *
         *     revisionId를 생략하면 head Revision을 반환한다. ETag는 **반환한 표현의** revision_no이며(기본 경로에서는 곧 head의 번호), 그대로 UNE-DOC-006/008/009의 If-Match 값이 된다. 과거 Revision을 명시 조회하면 head와 다른 값이 나가고 그것을 If-Match로 쓰면 409가 된다 — 과거 표현을 기준으로 쓰기를 시도하는 것은 실제로 충돌이므로 이것이 안전한 쪽이다. head 식별자는 응답 본문의 headRevisionId/headRevisionNo로도 함께 나간다.
         *
         *     ir_json이 v1로 적힌 행은 읽기 시 v2로 승격해 반환한다(liftedFromV1=true, ADR-30 D3). 승격은 origin=SOURCE 주입뿐이며 ID·앵커·텍스트는 바뀌지 않는다.
         */
        get: operations["une_doc_005"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/documents/{documentId}/changesets": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * ChangeSet 원자 적용
         * @description 권한: DOC_EDIT
         *
         *     핵심 요청: If-Match, baseRevisionId, origin, operations, clientMutationId
         *
         *     핵심 응답: ChangeSetResult(새 Revision + Diff + 역연산)
         *
         *     오류: DOC-409-001, DOC-422-004, COM-0409, COM-0428
         *
         *     이중 가드: If-Match(head revision_no)와 body.baseRevisionId가 모두 필요하다. 둘이 서로 다른 Revision을 가리키면 요청 자체가 자기모순이므로 422 DOC-422-004로 끝난다 — 재조회로 고쳐지지 않는 오류를 409로 답하면 클라이언트가 무한히 재시도한다. 둘이 일치하지만 head가 이미 움직였으면 409 DOC-409-001이며, 응답에 현재 ETag 헤더와 meta.conflict(currentRevisionId/currentRevisionNo/headIrHash)를 함께 싣는다.
         *
         *     원자성: change_set + change_operation N + document_revision + document 포인터 + audit_log가 한 트랜잭션이다. 연산 하나라도 실패하면 리비전은 생기지 않는다(설계 07 §1.9 on error rollback + no partial document mutation).
         *
         *     dryRun: 검증과 Diff까지만 하고 아무 행도 쓰지 않는다(US-PLAN-017 AC-01). ETag는 그대로 head의 값이 나간다.
         *
         *     멱등: clientMutationId가 앵커다(uk_change_set_mutation). 같은 값 + 같은 내용은 원래 결과를 replayed=true로 되돌려 주고, 같은 값 + 다른 내용은 409 COM-0409다. 재전송 응답의 diff는 비어 있다 — 문서 본문 미리보기를 재생산하려고 저장해 두지 않는다. **거절(REJECTED)된 요청의 재전송은 200이 아니라 다시 422다**: 200 + applied=false를 주면 오프라인 큐가 성공으로 처리해 사용자의 편집이 조용히 사라진다.
         *
         *     Undo/Redo: operations를 싣지 않고 undoesChangeSetId로 되돌릴 ChangeSet만 지목한다. 서버가 저장해 둔 역연산을 적용하므로 요청 표면에 IR 조각이 들어올 자리가 없다. 대상 이후 같은 노드를 건드린 ChangeSet이 있으면 422 DOC-422-004이며 violations에 영향 노드 ID가 실린다(US-PLAN-017 E-03).
         *
         *     상태: document.status가 EDITING이 아니면 422 DOC-422-004다(재조회로 고쳐지지 않는다).
         */
        post: operations["une_doc_006"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/documents/{documentId}/revisions": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Revision 목록
         * @description 권한: DOC_READ
         *
         *     핵심 요청: page, size
         *
         *     핵심 응답: Page<Revision> (origin, checkpointLabel 포함)
         *
         *     오류: DOC-404-002
         *
         *     버전이력 화면(US-PLAN-020 정상흐름 #3)이 쓰는 목록이다. 최신 Revision이 먼저 온다. 본문(ir_json)은 싣지 않는다 — 페이지당 수 MB가 되고, 화면이 필요로 하는 것은 작성자·시각·변경요약·출처·checkpoint 라벨뿐이다. 본문은 UNE-DOC-005로 개별 조회한다.
         *
         *     origin은 리비전이 왜 생겼는지를 질의 가능한 값으로 남긴 것이다 (IMPORT/MATERIALIZE/CHANGESET/AUTOSAVE/UNDO/REDO/RESTORE). checkpointLabel은 어휘가 정본에서 닫혀 있지 않아 enum이 아니다(0019 §2.2).
         */
        get: operations["une_doc_007"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/documents/{documentId}/revisions/{revisionId}/restore": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Revision 복원
         * @description 권한: DOC_EDIT
         *
         *     핵심 요청: If-Match, reason, checkpointLabel
         *
         *     핵심 응답: 새 head DocumentRevision
         *
         *     오류: DOC-409-002, DOC-404-001, COM-0428
         *
         *     US-PLAN-020 AC-01: 복원은 과거 revision을 변경하지 않고 새 head revision을 생성한다. 이 오퍼레이션에는 어떤 UPDATE document_revision도 없다 — 과거 리비전의 ir_json을 읽어서 새 행으로 넣고, 함께 남기는 change_set(origin=RESTORE)이 계보를 기록한다.
         *
         *     change_operation 행은 만들지 않는다: 복원은 8종 연산 어휘로 표현되는 편집이 아니라 이 시점의 문서로 되돌린다는 한 번의 사실이며, 어휘에 없는 연산을 지어내면 역연산 생성기가 전수 분기에서 실패한다.
         *
         *     If-Match는 현재 head의 revision_no다. 불일치는 409 DOC-409-002이며 현재 ETag와 meta.conflict를 함께 싣는다. 이미 head인 Revision을 복원 대상으로 지정하면 422 DOC-422-004다(같은 내용의 리비전을 하나 더 만드는 것은 이력 오염이다).
         */
        post: operations["une_doc_008"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/documents/{documentId}/autosaves": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * 자동저장
         * @description 권한: DOC_EDIT
         *
         *     핵심 요청: If-Match, baseRevisionId, delta, clientMutationId, seq
         *
         *     핵심 응답: AutosaveReceipt
         *
         *     오류: DOC-409-003, DOC-422-004, COM-0409, COM-0428
         *
         *     batch 1건이 저널 1행(document_autosave) + ChangeSet 1건 + Revision 1건이다. 수신확인(receipt)의 status는 셋뿐이다:
         *
         *     ACCEPTED — 반영되었다. resultRevisionId가 결과 리비전을 가리킨다. **내용이 그대로면 새 리비전을 만들지 않고 기존 head를 가리킨다**(ir_hash 동일 → ADR-30 D8 중복 제거): 같은 문자 재입력·입력 후 즉시 취소 같은 batch가 버전이력을 의미 없는 행으로 덮지 않게 한다. 저널 행은 그때도 남는다.
         *
         *     CONFLICT — head가 이미 움직였다. 409 DOC-409-003으로 나가지만 판정 자체는 저널에 남는다 — 그래야 화면이 저장 실패를 표시할 수 있다(US-PLAN-020 AC-02). 저널의 base_revision_id에는 **요청이 기준으로 삼은 Revision**을 적는다(재현 가능성). If-Match와 baseRevisionId가 서로 다른 Revision을 가리키는 자기모순 요청은 409가 아니라 422 DOC-422-004다 — 적용(UNE-DOC-006)과 같은 규칙이며, 재조회로 고쳐지지 않는 오류를 409로 답하면 클라이언트가 무한히 재시도한다.
         *
         *     SUPERSEDED — 도착했을 때 이미 같은 문서의 더 나중 자동저장이 반영돼 있었다 (A-01 오프라인 재동기화). 실패가 아니라 무해한 폐기이므로 200이다. 이 판정을 충돌보다 먼저 하는 이유: 늦게 도착한 항목은 baseRevisionId가 낡아 있는 것이 정상이라, 충돌로 판정하면 사용자에게 거짓 경보가 된다.
         *
         *     멱등: clientMutationId가 앵커다(uk_document_autosave_mutation). 오프라인 큐는 같은 항목을 여러 번 재전송하는 것이 정상 동작이므로, 이 유일성이 없으면 재전송이 곧 리비전 중복 생성이 된다. 같은 값 + 같은 delta는 같은 receipt를 replayed=true로 돌려주고, 같은 값 + 다른 delta는 409 COM-0409다.
         */
        post: operations["une_doc_009"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/documents/{documentId}/ai-edit-jobs": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * 선택영역 AI 편집 제안
         * @description 권한: DOC_AI_EDIT
         *
         *     핵심 요청: selection,prompt,ruleSnapshot
         *
         *     핵심 응답: GenerationJob
         *
         *     오류: DOC-422-005
         */
        post: operations["une_doc_010"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/documents/{documentId}/ai-edit-jobs/{jobId}/proposal": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * AI 편집 Diff 조회
         * @description 권한: DOC_READ
         *
         *     핵심 요청: -
         *
         *     핵심 응답: AiEditProposal
         *
         *     오류: DOC-404-003
         */
        get: operations["une_doc_011"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/documents/{documentId}/exports": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * HWPX/PDF/DOCX Export
         * @description 권한: DOC_EXPORT
         *
         *     핵심 요청: revisionId,format,options
         *
         *     핵심 응답: ExportJob
         *
         *     오류: EXPORT-422-001
         */
        post: operations["une_doc_012"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/exports/{exportId}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Export 상태·검증결과
         * @description 권한: DOC_READ
         *
         *     핵심 요청: -
         *
         *     핵심 응답: ExportJob
         *
         *     오류: EXPORT-404-001
         */
        get: operations["une_doc_013"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/exports/{exportId}/download": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Export 파일 다운로드
         * @description 권한: DOC_READ
         *
         *     핵심 요청: -
         *
         *     핵심 응답: binary
         *
         *     오류: EXPORT-410-001
         */
        get: operations["une_doc_014"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/documents/{documentId}/submit-review": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * 검토 요청
         * @description 권한: DOC_EDIT
         *
         *     핵심 요청: reviewerIds,message
         *
         *     핵심 응답: ReviewRequest
         *
         *     오류: REVIEW-422-001
         */
        post: operations["une_doc_015"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/documents/{documentId}/review-comments": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * 검토의견 등록
         * @description 권한: DOC_REVIEW
         *
         *     핵심 요청: anchor,comment,severity
         *
         *     핵심 응답: ReviewComment
         *
         *     오류: REVIEW-422-002
         */
        post: operations["une_doc_016"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/documents/{documentId}/approve": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * 문서 승인
         * @description 권한: DOC_APPROVE
         *
         *     핵심 요청: revisionId,comment
         *
         *     핵심 응답: Document
         *
         *     오류: APPROVAL-412-001
         */
        post: operations["une_doc_017"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/situations": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * 상황·훈련 목록
         * @description 권한: SITUATION_READ
         *
         *     핵심 요청: mode,status,hazardType,page
         *
         *     핵심 응답: Page<Situation>
         *
         *     오류: SIT-5002
         */
        get: operations["une_sit_002"];
        put?: never;
        /**
         * 실재난/훈련 등록
         * @description 권한: SITUATION_CREATE
         *
         *     핵심 요청: mode,title,hazardType,occurredAt,location
         *
         *     핵심 응답: Situation
         *
         *     오류: SIT-5001
         */
        post: operations["une_sit_001"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/situations/{id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * 상황 상세
         * @description 권한: SITUATION_READ
         *
         *     핵심 요청: id
         *
         *     핵심 응답: SituationDetail
         *
         *     오류: SIT-404-001
         */
        get: operations["une_sit_003"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        /**
         * 상황 기본정보 수정
         * @description 권한: SITUATION_EDIT
         *
         *     핵심 요청: If-Match,patch
         *
         *     핵심 응답: Situation
         *
         *     오류: SIT-409-001
         */
        patch: operations["une_sit_004"];
        trace?: never;
    };
    "/situations/{id}/provider-queries": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * 공식·보조 Provider 조회
         * @description 권한: SITUATION_FACT_COLLECT
         *
         *     핵심 요청: providers,query,featureFlags
         *
         *     핵심 응답: ProviderQueryJob
         *
         *     오류: PROV-503-001
         */
        post: operations["une_sit_005"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/provider-jobs/{jobId}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Provider 수집 Job 상태
         * @description 권한: SITUATION_READ
         *
         *     핵심 요청: jobId
         *
         *     핵심 응답: ProviderJob
         *
         *     오류: PROV-404-001
         */
        get: operations["une_sit_015"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/provider-jobs/{jobId}/events": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Provider 수집 SSE
         * @description 권한: SITUATION_READ
         *
         *     핵심 요청: Last-Event-ID
         *
         *     핵심 응답: SSE<ProviderEvent>
         *
         *     오류: PROV-503-002
         */
        get: operations["une_sit_006"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/situations/{id}/facts": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * 후보 Fact 목록
         * @description 권한: SITUATION_READ
         *
         *     핵심 요청: id,status,factType,page
         *
         *     핵심 응답: Page<SituationFact>
         *
         *     오류: FACT-404-001
         */
        get: operations["une_sit_014"];
        put?: never;
        /**
         * 수동 Fact 등록
         * @description 권한: SITUATION_FACT_EDIT
         *
         *     핵심 요청: factType,key,value,source,observedAt
         *
         *     핵심 응답: SituationFact
         *
         *     오류: FACT-422-001
         */
        post: operations["une_sit_007"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/situations/{id}/facts/{factId}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        /**
         * 후보 Fact 보정
         * @description 권한: SITUATION_FACT_EDIT
         *
         *     핵심 요청: If-Match,patch
         *
         *     핵심 응답: SituationFact
         *
         *     오류: FACT-409-001
         */
        patch: operations["une_sit_008"];
        trace?: never;
    };
    "/situations/{id}/facts/deduplicate": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Fact 중복군 계산
         * @description 권한: SITUATION_FACT_EDIT
         *
         *     핵심 요청: strategy,threshold
         *
         *     핵심 응답: DuplicateGroup[]
         *
         *     오류: FACT-422-002
         */
        post: operations["une_sit_009"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/situations/{id}/conflicts": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Fact 충돌 목록
         * @description 권한: SITUATION_READ
         *
         *     핵심 요청: status
         *
         *     핵심 응답: Conflict[]
         *
         *     오류: FACT-404-002
         */
        get: operations["une_sit_010"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/situations/{id}/conflicts/{conflictId}/resolve": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Fact 충돌 확정
         * @description 권한: SITUATION_CONFIRM
         *
         *     핵심 요청: selectedFactId,reason
         *
         *     핵심 응답: ConflictResolution
         *
         *     오류: SIT-412-003
         */
        post: operations["une_sit_011"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/situations/{id}/snapshots": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Snapshot 목록·Diff
         * @description 권한: SITUATION_READ
         *
         *     핵심 요청: compareTo
         *
         *     핵심 응답: Snapshot[]
         *
         *     오류: SIT-404-003
         */
        get: operations["une_sit_013"];
        put?: never;
        /**
         * SituationSnapshot 확정
         * @description 권한: SITUATION_CONFIRM
         *
         *     핵심 요청: factIds,effectiveAt,expectedSnapshotId,reason (resolutionIds는 받지 않는다 — ADR-34 D6)
         *
         *     핵심 응답: SituationSnapshot
         *
         *     오류: SIT-409-004,SIT-412-003,SIT-422-006
         */
        post: operations["une_sit_012"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/situations/{id}/knowledge-documents": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * 훈련·매뉴얼 자료 등록
         * @description 권한: KNOWLEDGE_UPLOAD
         *
         *     핵심 요청: fileId,documentType,metadata
         *
         *     핵심 응답: KnowledgeDocument
         *
         *     오류: KNOW-422-001
         */
        post: operations["une_know_001"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/knowledge-documents/{id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * UNI 처리상태 조회
         * @description 권한: KNOWLEDGE_READ
         *
         *     핵심 요청: -
         *
         *     핵심 응답: KnowledgeDocument
         *
         *     오류: UNI-503-001
         */
        get: operations["une_know_002"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/knowledge-documents/{id}/retry": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * UNI 학습 재시도
         * @description 권한: KNOWLEDGE_UPLOAD
         *
         *     핵심 요청: reason
         *
         *     핵심 응답: KnowledgeDocument
         *
         *     오류: UNI-409-001
         */
        post: operations["une_know_003"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/situations/{id}/evidence-searches": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * UNI RAG 근거 검색
         * @description 권한: EVIDENCE_SEARCH
         *
         *     핵심 요청: snapshotId,query,filters,topK
         *
         *     핵심 응답: EvidenceSet
         *
         *     오류: UNI-422-002
         */
        post: operations["une_know_004"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/evidence-sets/{id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * EvidenceSet 조회
         * @description 권한: EVIDENCE_READ
         *
         *     핵심 요청: -
         *
         *     핵심 응답: EvidenceSet
         *
         *     오류: EVID-404-001
         */
        get: operations["une_know_005"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/evidence-sets/{id}/lock": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * EvidenceSet 고정
         * @description 권한: EVIDENCE_LOCK
         *
         *     핵심 요청: reason
         *
         *     핵심 응답: EvidenceSet
         *
         *     오류: EVID-409-001
         */
        post: operations["une_know_006"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/evidence-items/{id}/source": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * 근거 원문 위치 조회
         * @description 권한: EVIDENCE_READ
         *
         *     핵심 요청: -
         *
         *     핵심 응답: SourceLocator
         *
         *     오류: EVID-404-002
         */
        get: operations["une_know_007"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/situations/{id}/sop-generation-jobs": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * UNI 구조화 SOP 생성
         * @description 권한: SOP_GENERATE
         *
         *     핵심 요청: snapshotId,evidenceSetId,schemaVersion
         *
         *     핵심 응답: GenerationJob
         *
         *     오류: UNI-422-003
         */
        post: operations["une_sop_001"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/sop-generation-jobs/{jobId}/events": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * SOP 생성 SSE
         * @description 권한: SOP_READ
         *
         *     핵심 요청: Last-Event-ID
         *
         *     핵심 응답: SSE<SopGenerationEvent>
         *
         *     오류: UNI-503-003
         */
        get: operations["une_sop_002"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/sops": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * SOP 목록
         * @description 권한: SOP_READ
         *
         *     핵심 요청: status,hazardType,page
         *
         *     핵심 응답: Page<Sop>
         *
         *     오류: SOP-6002
         */
        get: operations["une_sop_004"];
        put?: never;
        /**
         * SOP 정의 생성
         * @description 권한: SOP_EDIT
         *
         *     핵심 요청: situationId,title,hazardType
         *
         *     핵심 응답: Sop
         *
         *     오류: SOP-6001
         */
        post: operations["une_sop_003"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/sops/{sopId}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * SOP 그래프 조회
         * @description 권한: SOP_READ
         *
         *     핵심 요청: versionId
         *
         *     핵심 응답: SopGraph
         *
         *     오류: SOP-404-001
         */
        get: operations["une_sop_005"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/sops/{sopId}/versions": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * SOP Draft 버전 저장
         * @description 권한: SOP_EDIT
         *
         *     핵심 요청: baseVersionId,nodes,edges
         *
         *     핵심 응답: SopVersion
         *
         *     오류: SOP-409-001
         */
        post: operations["une_sop_006"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/sops/{sopId}/validate": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * DAG·임무·분기 검증
         * @description 권한: SOP_EDIT
         *
         *     핵심 요청: versionId
         *
         *     핵심 응답: SopValidationReport
         *
         *     오류: SOP-422-007
         */
        post: operations["une_sop_007"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/sops/{sopId}/submit-review": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * SOP 검토 요청
         * @description 권한: SOP_EDIT
         *
         *     핵심 요청: versionId,reviewers
         *
         *     핵심 응답: ReviewRequest
         *
         *     오류: SOP-412-001
         */
        post: operations["une_sop_008"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/sops/{sopId}/approve": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * SOP 승인·버전 고정
         * @description 권한: SOP_APPROVE
         *
         *     핵심 요청: versionId,comment
         *
         *     핵심 응답: SopVersion
         *
         *     오류: SOP-412-002
         */
        post: operations["une_sop_009"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/sops/{sopId}/simulations": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Dry-run 시작
         * @description 권한: SOP_RUN
         *
         *     핵심 요청: versionId,snapshotId,scenario
         *
         *     핵심 응답: SopRun
         *
         *     오류: SOP-422-008
         */
        post: operations["une_sop_010"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/sops/{sopId}/runs": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * 실행 시작
         * @description 권한: SOP_RUN
         *
         *     핵심 요청: approvedVersionId,snapshotId,mode,startPolicy
         *
         *     핵심 응답: SopRun
         *
         *     오류: SOP-409-005
         */
        post: operations["une_sop_011"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/sop-runs/{runId}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * 실행 상세
         * @description 권한: SOP_READ
         *
         *     핵심 요청: -
         *
         *     핵심 응답: SopRunDetail
         *
         *     오류: SOP-404-002
         */
        get: operations["une_sop_012"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/sop-runs/{runId}/events": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * 실행 SSE
         * @description 권한: SOP_READ
         *
         *     핵심 요청: Last-Event-ID
         *
         *     핵심 응답: SSE<ExecutionEvent>
         *
         *     오류: SOP-503-001
         */
        get: operations["une_sop_013"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/sop-runs/{runId}/pause": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * 실행 일시중지
         * @description 권한: SOP_RUN_CONTROL
         *
         *     핵심 요청: reason
         *
         *     핵심 응답: SopRun
         *
         *     오류: SOP-409-006
         */
        post: operations["une_sop_014"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/sop-runs/{runId}/resume": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * 실행 재개
         * @description 권한: SOP_RUN_CONTROL
         *
         *     핵심 요청: reason
         *
         *     핵심 응답: SopRun
         *
         *     오류: SOP-409-007
         */
        post: operations["une_sop_015"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/sop-runs/{runId}/terminate": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * 실행 강제종료
         * @description 권한: SOP_RUN_CONTROL
         *
         *     핵심 요청: reason,confirmCode
         *
         *     핵심 응답: SopRun
         *
         *     오류: SOP-409-008
         */
        post: operations["une_sop_016"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/tasks": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * 임무 목록
         * @description 권한: TASK_READ
         *
         *     핵심 요청: assignee,status,situationId,due,page
         *
         *     핵심 응답: Page<Task>
         *
         *     오류: TASK-7001
         */
        get: operations["une_task_001"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/tasks/{taskId}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * 임무 상세
         * @description 권한: TASK_READ
         *
         *     핵심 요청: -
         *
         *     핵심 응답: TaskDetail
         *
         *     오류: TASK-404-001
         */
        get: operations["une_task_002"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/tasks/{taskId}/dispatch": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * 임무·상황 전파
         * @description 권한: TASK_DISPATCH
         *
         *     핵심 요청: channels,recipients,messageTemplate
         *
         *     핵심 응답: Dispatch
         *
         *     오류: OUTBOX-503-001
         */
        post: operations["une_task_003"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/tasks/{taskId}/acknowledge": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * 수신확인
         * @description 권한: TASK_ASSIGNEE
         *
         *     핵심 요청: receivedAt,deviceInfo
         *
         *     핵심 응답: TaskEvent
         *
         *     오류: TASK-409-001
         */
        post: operations["une_task_004"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/tasks/{taskId}/start": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * 임무 착수
         * @description 권한: TASK_ASSIGNEE
         *
         *     핵심 요청: startedAt,note
         *
         *     핵심 응답: TaskEvent
         *
         *     오류: TASK-409-002
         */
        post: operations["une_task_005"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/tasks/{taskId}/progress": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * 진행보고
         * @description 권한: TASK_ASSIGNEE
         *
         *     핵심 요청: progress,note,attachmentIds
         *
         *     핵심 응답: TaskEvent
         *
         *     오류: TASK-422-006
         */
        post: operations["une_task_006"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/tasks/{taskId}/complete": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * 완료보고
         * @description 권한: TASK_ASSIGNEE
         *
         *     핵심 요청: completedAt,result,evidenceIds,checklist
         *
         *     핵심 응답: TaskEvent
         *
         *     오류: TASK-422-008
         */
        post: operations["une_task_007"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/tasks/{taskId}/approve-completion": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * 완료 승인
         * @description 권한: TASK_SUPERVISE
         *
         *     핵심 요청: comment
         *
         *     핵심 응답: TaskEvent
         *
         *     오류: TASK-409-004
         */
        post: operations["une_task_008"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/tasks/{taskId}/reject-completion": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * 완료 반려
         * @description 권한: TASK_SUPERVISE
         *
         *     핵심 요청: reason
         *
         *     핵심 응답: TaskEvent
         *
         *     오류: TASK-409-005
         */
        post: operations["une_task_009"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/tasks/{taskId}/reassign": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * 임무 재배정
         * @description 권한: TASK_SUPERVISE
         *
         *     핵심 요청: assigneeId,reason
         *
         *     핵심 응답: TaskEvent
         *
         *     오류: TASK-409-006
         */
        post: operations["une_task_010"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/tasks/{taskId}/escalate": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Escalation
         * @description 권한: TASK_SUPERVISE
         *
         *     핵심 요청: level,reason,targetIds
         *
         *     핵심 응답: TaskEvent
         *
         *     오류: TASK-409-007
         */
        post: operations["une_task_011"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/tasks/{taskId}/attachments": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * 현장 파일 등록
         * @description 권한: TASK_ASSIGNEE
         *
         *     핵심 요청: fileId,category,caption,geo
         *
         *     핵심 응답: TaskAttachment
         *
         *     오류: FILE-422-003
         */
        post: operations["une_task_012"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/dispatches/{id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * 전파·수신 상태 조회
         * @description 권한: TASK_READ
         *
         *     핵심 요청: -
         *
         *     핵심 응답: DispatchStatus
         *
         *     오류: DISP-404-001
         */
        get: operations["une_task_013"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/dispatches/{id}/retry": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * 실패 수신자 재전파
         * @description 권한: TASK_DISPATCH
         *
         *     핵심 요청: recipientIds,channelOverride
         *
         *     핵심 응답: Dispatch
         *
         *     오류: DISP-409-001
         */
        post: operations["une_task_014"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/situations/{id}/dashboard": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * 전자상황판 집계
         * @description 권한: DASHBOARD_READ
         *
         *     핵심 요청: at,runId
         *
         *     핵심 응답: DashboardView
         *
         *     오류: DASH-8001
         */
        get: operations["une_jnl_001"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/situations/{id}/execution-events": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Execution Log 조회
         * @description 권한: EXECUTION_READ
         *
         *     핵심 요청: from,to,type,actor,page
         *
         *     핵심 응답: Page<ExecutionEvent>
         *
         *     오류: EXEC-8002
         */
        get: operations["une_jnl_002"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/execution-events/{eventId}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * 원본 Event 상세
         * @description 권한: EXECUTION_READ
         *
         *     핵심 요청: -
         *
         *     핵심 응답: ExecutionEventDetail
         *
         *     오류: EXEC-404-001
         */
        get: operations["une_jnl_003"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/execution-events/{eventId}/corrections": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * 정정 Event 추가
         * @description 권한: EXECUTION_CORRECT
         *
         *     핵심 요청: reason,replacementFields
         *
         *     핵심 응답: ExecutionEvent
         *
         *     오류: EXEC-409-001
         */
        post: operations["une_jnl_004"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/situations/{id}/journal-projections": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * 상황일지 Projection 생성
         * @description 권한: JOURNAL_CREATE
         *
         *     핵심 요청: snapshotId,from,to,templateId,eventTypes
         *
         *     핵심 응답: Journal
         *
         *     오류: JOURNAL-412-001
         */
        post: operations["une_jnl_005"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/journals/{journalId}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * 상황일지 상세
         * @description 권한: JOURNAL_READ
         *
         *     핵심 요청: revisionId
         *
         *     핵심 응답: JournalDetail
         *
         *     오류: JOURNAL-404-001
         */
        get: operations["une_jnl_006"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/journals/{journalId}/ai-draft-jobs": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * 상황일지 서술 제안
         * @description 권한: JOURNAL_AI_EDIT
         *
         *     핵심 요청: sections,styleRules
         *
         *     핵심 응답: GenerationJob
         *
         *     오류: JOURNAL-422-004
         */
        post: operations["une_jnl_007"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/journals/{journalId}/changesets": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * 상황일지 편집
         * @description 권한: JOURNAL_EDIT
         *
         *     핵심 요청: baseRevisionId,operations
         *
         *     핵심 응답: JournalRevision
         *
         *     오류: JOURNAL-409-001
         */
        post: operations["une_jnl_008"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/journals/{journalId}/submit-review": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * 상황일지 검토요청
         * @description 권한: JOURNAL_EDIT
         *
         *     핵심 요청: reviewers,message
         *
         *     핵심 응답: ReviewRequest
         *
         *     오류: JOURNAL-412-002
         */
        post: operations["une_jnl_009"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/journals/{journalId}/approve": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * 상황일지 승인
         * @description 권한: JOURNAL_APPROVE
         *
         *     핵심 요청: revisionId,comment
         *
         *     핵심 응답: Journal
         *
         *     오류: JOURNAL-412-003
         */
        post: operations["une_jnl_010"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/journals/{journalId}/exports": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * 상황일지 HWPX/PDF/DOCX
         * @description 권한: JOURNAL_EXPORT
         *
         *     핵심 요청: format,revisionId
         *
         *     핵심 응답: ExportJob
         *
         *     오류: EXPORT-422-002
         */
        post: operations["une_jnl_011"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/situations/{id}/close": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * 상황·훈련 종료
         * @description 권한: SITUATION_CLOSE
         *
         *     핵심 요청: resultSummary,openTaskPolicy
         *
         *     핵심 응답: Situation
         *
         *     오류: SIT-412-010
         */
        post: operations["une_jnl_012"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/situations/{id}/evaluations": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * 훈련 평가 생성
         * @description 권한: EVALUATION_EDIT
         *
         *     핵심 요청: criteria,scores,comments,evidenceEventIds
         *
         *     핵심 응답: Evaluation
         *
         *     오류: EVAL-422-001
         */
        post: operations["une_jnl_013"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/evaluations/{id}/improvements": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * 개선조치 등록
         * @description 권한: EVALUATION_EDIT
         *
         *     핵심 요청: actions,owners,dueDates
         *
         *     핵심 응답: ImprovementPlan
         *
         *     오류: EVAL-422-002
         */
        post: operations["une_jnl_014"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/evaluations/{id}/report": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * 만족도·잠재가치·평가보고서
         * @description 권한: EVALUATION_READ
         *
         *     핵심 요청: format
         *
         *     핵심 응답: EvaluationReport
         *
         *     오류: EVAL-404-001
         */
        get: operations["une_jnl_015"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/admin/access/summary": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * 기관·사용자·RBAC 요약
         * @description 권한: ADMIN_ACCESS
         *
         *     핵심 요청: -
         *
         *     핵심 응답: AccessSummary
         *
         *     오류: ADMIN-9001
         */
        get: operations["une_admin_001"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/admin/users/{id}/roles": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        /**
         * 사용자 역할 Binding
         * @description 권한: ADMIN_ACCESS
         *
         *     핵심 요청: roleIds,scope
         *
         *     핵심 응답: UserRole[]
         *
         *     오류: ADMIN-409-001
         */
        put: operations["une_admin_002"];
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/admin/organization-bindings": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * 조직·수신자 Binding 조회
         * @description 권한: ADMIN_ORG
         *
         *     핵심 요청: -
         *
         *     핵심 응답: Binding[]
         *
         *     오류: ADMIN-9002
         */
        get: operations["une_admin_003"];
        put?: never;
        /**
         * 조직·채널 Binding 생성
         * @description 권한: ADMIN_ORG
         *
         *     핵심 요청: orgId,recipientId,channels
         *
         *     핵심 응답: Binding
         *
         *     오류: ADMIN-422-001
         */
        post: operations["une_admin_004"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/admin/audit-logs": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * 감사로그 검색
         * @description 권한: AUDIT_READ
         *
         *     핵심 요청: actor,action,resource,from,to,page
         *
         *     핵심 응답: Page<AuditLog>
         *
         *     오류: AUDIT-9001
         */
        get: operations["une_admin_005"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/admin/outbox": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Outbox 운영조회
         * @description 권한: ADMIN_OUTBOX
         *
         *     핵심 요청: status,channel,page
         *
         *     핵심 응답: Page<OutboxMessage>
         *
         *     오류: OUTBOX-9001
         */
        get: operations["une_admin_006"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/admin/outbox/{id}/retry": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Outbox 수동 재처리
         * @description 권한: ADMIN_OUTBOX
         *
         *     핵심 요청: reason
         *
         *     핵심 응답: OutboxMessage
         *
         *     오류: OUTBOX-409-001
         */
        post: operations["une_admin_007"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/admin/provider-configs": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Provider·T3Q·UNI 설정조회
         * @description 권한: ADMIN_INTEGRATION
         *
         *     핵심 요청: -
         *
         *     핵심 응답: ProviderConfig[]
         *
         *     오류: PROV-9001
         */
        get: operations["une_admin_008"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/admin/provider-configs/{id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        /**
         * Provider 설정변경
         * @description 권한: ADMIN_INTEGRATION
         *
         *     핵심 요청: If-Match,patch
         *
         *     핵심 응답: ProviderConfig
         *
         *     오류: PROV-409-001
         */
        patch: operations["une_admin_009"];
        trace?: never;
    };
    "/admin/provider-configs/{id}/test": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Provider 연결시험
         * @description 권한: ADMIN_INTEGRATION
         *
         *     핵심 요청: testMode
         *
         *     핵심 응답: ProviderHealth
         *
         *     오류: PROV-503-010
         */
        post: operations["une_admin_010"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/admin/retention-policies": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * 보존정책 조회
         * @description 권한: ADMIN_SECURITY
         *
         *     핵심 요청: -
         *
         *     핵심 응답: RetentionPolicy[]
         *
         *     오류: RET-9001
         */
        get: operations["une_admin_011"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/admin/retention-policies/{id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        /**
         * 보존정책 변경
         * @description 권한: ADMIN_SECURITY
         *
         *     핵심 요청: If-Match,patch
         *
         *     핵심 응답: RetentionPolicy
         *
         *     오류: RET-409-001
         */
        patch: operations["une_admin_012"];
        trace?: never;
    };
};
export type webhooks = Record<string, never>;
export type components = {
    schemas: {
        Meta: {
            requestId: string;
            correlationId: string;
            /** Format: date-time */
            timestamp: string;
            schemaVersion: string;
        };
        Error: {
            code: string;
            message: string;
            detail?: string | null;
            recoverable: boolean;
            userAction?: string | null;
        };
        ErrorEnvelope: {
            /** @enum {boolean} */
            success: false;
            error: components["schemas"]["Error"];
            meta: components["schemas"]["Meta"];
        };
        GenericRequest: {
            [key: string]: unknown;
        };
        GenericResponse: {
            [key: string]: unknown;
        };
        PageResponse: {
            items?: unknown[];
            page?: number;
            size?: number;
            totalElements?: number;
            totalPages?: number;
        };
        SsoExchangeRequest: {
            externalToken: string;
            /** Format: uri */
            returnUrl?: string;
        };
        TokenResponse: {
            success: boolean;
            data: {
                accessToken: string;
                refreshToken: string;
                expiresIn: number;
                userContext: Record<string, never>;
            };
            meta: Record<string, never>;
        };
        /** @enum {string} */
        PlanHazardType: "폭염" | "태풍/호우" | "지진" | "황사" | "산불" | "감염병" | "가축질병" | "다중밀집건축물붕괴대형사고" | "정부주요시설" | "학교시설";
        /** @enum {string} */
        PlanManagementPhase: "예방" | "대비";
        /** @enum {string} */
        PlanStatus: "DRAFT" | "CONTEXT_READY" | "OUTLINE_GENERATING" | "OUTLINE_REVIEW" | "OUTLINE_CONFIRMED" | "CONTENT_GENERATING" | "EDITING" | "REVIEW_REQUESTED" | "CHANGES_REQUESTED" | "APPROVED" | "FINAL" | "REOPENED" | "ERROR";
        /** @enum {string} */
        PlanStartMode: "BLANK" | "UPLOAD_HWPX" | "RECENT";
        PlanResource: {
            /** Format: uuid */
            planId: string;
            /** Format: uuid */
            tenantId: string;
            title: string;
            hazardType: components["schemas"]["PlanHazardType"];
            managementPhase: components["schemas"]["PlanManagementPhase"];
            status: components["schemas"]["PlanStatus"];
            /** Format: uuid */
            documentId?: string | null;
            /** Format: uuid */
            currentContextSnapshotId?: string | null;
            /** Format: uuid */
            currentTocVersionId?: string | null;
            startMode?: components["schemas"]["PlanStartMode"];
            /** @description 낙관적 잠금 버전 (If-Match/ETag 값) */
            versionNo: number;
            /**
             * Format: date-time
             * @description 휴지통 이동 시각 (null이면 활성)
             */
            deletedAt?: string | null;
            /** Format: date-time */
            createdAt: string;
            /** Format: date-time */
            updatedAt: string;
        };
        PlanContextSnapshotResource: {
            /** Format: uuid */
            contextSnapshotId: string;
            /** Format: uuid */
            planId: string;
            versionNo: number;
            contextJson: components["schemas"]["PlanContext"];
            contentHash: string;
            /** Format: uuid */
            supersedesId?: string | null;
            /** Format: uuid */
            confirmedBy: string;
            /** Format: date-time */
            confirmedAt: string;
        };
        ContextDraftResource: {
            /** Format: uuid */
            contextDraftId: string;
            /** Format: uuid */
            planId: string;
            contextJson: {
                [key: string]: unknown;
            };
            schemaVersion: string;
            /** Format: uuid */
            updatedBy: string;
            /** Format: date-time */
            updatedAt: string;
        };
        PlanResponse: {
            success: boolean;
            data: components["schemas"]["PlanResource"];
            meta: Record<string, never>;
        };
        PlanDetailResponse: {
            success: boolean;
            data: {
                /** @description 현재 확정 Snapshot (없으면 null) */
                currentContextSnapshot?: components["schemas"]["PlanContextSnapshotResource"] | null;
            } & components["schemas"]["PlanResource"];
            meta: Record<string, never>;
        };
        PlanPageResponse: {
            success: boolean;
            data: {
                items: components["schemas"]["PlanResource"][];
                page: number;
                size: number;
                totalElements: number;
                totalPages: number;
            };
            meta: Record<string, never>;
        };
        ContextDraftResponse: {
            success: boolean;
            data: components["schemas"]["ContextDraftResource"];
            meta: Record<string, never>;
        };
        PlanContextSnapshotResponse: {
            success: boolean;
            data: components["schemas"]["PlanContextSnapshotResource"];
            meta: Record<string, never>;
        };
        PlanContextSnapshotListResponse: {
            success: boolean;
            data: {
                items: components["schemas"]["PlanContextSnapshotResource"][];
            };
            meta: Record<string, never>;
        };
        PlanCreateRequest: {
            title: string;
            startMode: components["schemas"]["PlanStartMode"];
            hazardType: components["schemas"]["PlanHazardType"];
            managementPhase: components["schemas"]["PlanManagementPhase"];
            /**
             * Format: uuid
             * @description 파일 업로드는 CC-140 범위로 보류 — 값이 제공되면 400 PLAN-4001로 거부한다 (ADR-23 D3).
             */
            templateFileId?: string | null;
        };
        PlanMetaPatchRequest: {
            title?: string;
            hazardType?: components["schemas"]["PlanHazardType"];
            managementPhase?: components["schemas"]["PlanManagementPhase"];
        };
        PlanDeleteRequest: {
            reason?: string;
        };
        PlanContextDraftRequest: {
            /** @description 완화 검증 대상 기준정보 작업본 (미완성 허용, ADR-23 D2) */
            context: {
                [key: string]: unknown;
            };
            /** @default 1.0 */
            schemaVersion: string;
        };
        /** @description 엄격 검증: contracts/schemas/plan-context.schema.json (additionalProperties 불가). Snapshot 확정은 전체 스키마 통과 필수, draft는 required/minLength/minItems만 유예 */
        PlanContext: {
            [key: string]: unknown;
        };
        /** @enum {string} */
        JobStatus: "QUEUED" | "RUNNING" | "CANCEL_REQUESTED" | "COMPLETED" | "FAILED" | "CANCELLED";
        GenerationJobResource: {
            /** Format: uuid */
            jobId: string;
            /** @enum {string} */
            jobType: "TOC" | "CONTENT" | "AI_EDIT" | "SOP";
            /** @description 대상 Aggregate 종류 (설계 10 §6.15 어휘 PLAN/DOCUMENT/SITUATION) */
            aggregateType: string;
            /** Format: uuid */
            aggregateId: string;
            /** @enum {string} */
            providerCode: "T3Q" | "UNI" | "UNE";
            status: components["schemas"]["JobStatus"];
            progressPct: number;
            /** @description 워커 실행 시도 횟수. 생성 시 0이고 워커가 선점할 때마다 +1 한다 (첫 실행 후 1). UNE-PLAN-013 사용자 재시도는 0으로 리셋한다 (마이그레이션 0015 generation_job.attempt_no / ADR-25 D9). */
            attemptNo: number;
            correlationId: string;
            /** Format: date-time */
            startedAt?: string | null;
            /** Format: date-time */
            finishedAt?: string | null;
            error?: {
                code?: string;
                message?: string;
                retryable?: boolean;
            } | null;
            /** @description 완료된 Job의 산출물. 진행 중이거나 실패면 null. TOC Job은 tocVersionId/tocVersionNo를, CONTENT Job(UNE-PLAN-016)은 contentSummary와 입력 tocVersionId를 싣는다. Job 타입별 oneOf 분기를 두지 않는 이유는 생성 타입이 파괴되기 때문이며, 타입별로 실리는 속성만 다르다. */
            result?: {
                /** Format: uuid */
                tocVersionId?: string;
                tocVersionNo?: number;
                /** @description CONTENT Job 집계. generated+preserved+failed는 이번 job의 대상 노드 수와 일치한다. 범위 지정 재생성(targetNodeKeys)에서 범위 밖 노드는 대상이 아니므로 어느 항목에도 집계되지 않는다. */
                contentSummary?: {
                    /** @description 새로 생성된 블록 수. */
                    generated?: number;
                    /** @description 보호(protection_state=USER_LOCKED 또는 SYSTEM_LOCKED)로 재생성하지 않고 유지한 블록 수. */
                    preserved?: number;
                    /** @description 생성에 실패한 노드 수 (content.block outcome=FAILED). legacy 경로에서는 항상 0이다 — provider 응답 정합 위반은 job 전체를 FAILED로 만들고, 블록 단위 실패는 target-v2 partialRetry(CC-135) 소관이다. */
                    failed?: number;
                    /** @description 근거(EvidenceLink)가 하나도 연결되지 않은 생성 블록 수. 사실값 검토 대상 지표다. */
                    blocksWithoutEvidence?: number;
                    /**
                     * Format: uuid
                     * @description 본문 생성의 기준이 된 목차 버전 id.
                     */
                    tocVersionId?: string;
                };
            } | null;
            /** Format: date-time */
            createdAt: string;
        };
        GenerationJobResponse: {
            success: boolean;
            data: components["schemas"]["GenerationJobResource"];
            meta: Record<string, never>;
        };
        TocNodeResource: {
            nodeKey: string;
            title: string;
            /** @description 목차 계층은 1~6단계 (마이그레이션 0015 ck_toc_node_level, SCR-PLAN-006) */
            level: number;
            sortOrder: number;
            generationPolicy?: {
                [key: string]: unknown;
            };
            children?: components["schemas"]["TocNodeResource"][];
        };
        TocVersionResource: {
            /** Format: uuid */
            tocVersionId: string;
            /** Format: uuid */
            planId: string;
            versionNo: number;
            /** @enum {string} */
            sourceType: "AI" | "USER";
            /** Format: uuid */
            baseSnapshotId: string;
            /** @enum {string} */
            status: "DRAFT" | "CONFIRMED";
            contentHash: string;
            /** Format: uuid */
            createdBy: string;
            /** Format: date-time */
            createdAt: string;
            nodes: components["schemas"]["TocNodeResource"][];
        };
        TocVersionResponse: {
            success: boolean;
            data: components["schemas"]["TocVersionResource"];
            meta: Record<string, never>;
        };
        TocTreeNodeInput: {
            /** @description 기존 노드를 승계할 때만 지정한다. 미지정이면 서버가 새로 발급한다. */
            nodeKey?: string;
            title: string;
            generationPolicy?: {
                [key: string]: unknown;
            };
            children?: components["schemas"]["TocTreeNodeInput"][];
        };
        TocGenerationRequest: {
            /** Format: uuid */
            contextSnapshotId: string;
            generationOption?: {
                additionalInstruction?: string;
                notes?: string;
            };
        };
        GenerationJobCancelRequest: {
            reason?: string;
        };
        GenerationJobRetryRequest: {
            reason?: string;
            /** @description 예약 필드. TOC/CONTENT 어느 Job이든 값이 오면 400 PLAN-4001로 거절한다. 블록 단위 provider 재시도는 target-v2 partialRetry(CC-135) 소관이며, 범위 지정 재생성은 UNE-PLAN-016의 targetNodeKeys로 새 job을 생성해야 한다. */
            blockIds?: string[];
        };
        TocVersionSaveRequest: {
            /** Format: uuid */
            baseVersionId: string;
            /** @description 중첩 깊이는 6단계까지 허용한다 (초과 시 422 PLAN-422-002). */
            tocTree: components["schemas"]["TocTreeNodeInput"][];
            /** @default false */
            confirm: boolean;
        };
        ContentGenerationRequest: {
            /**
             * Format: uuid
             * @description 계획서의 현재 확정 PlanContextSnapshot id. 다른 값이면 400 PLAN-4001, 확정 스냅샷이 없으면 412 PLAN-412-001.
             */
            contextSnapshotId: string;
            /**
             * Format: uuid
             * @description 본문 생성의 기준이 되는 확정(CONFIRMED) 목차 버전 id. 계획서에 속하지 않거나 없으면 404 TOC-404-001, 미확정이면 412 PLAN-412-002.
             */
            tocVersionId: string;
            /** @description 범위 지정 재생성. 지정하면 해당 노드의 subtree만 재생성하고 나머지 블록은 보존한다. 미지정이면 목차 전체를 생성한다(빈 배열은 400 PLAN-4001 — "전체"는 필드 생략으로 표현한다). 목차 버전에 없는 nodeKey는 422 PLAN-422-002. */
            targetNodeKeys?: string[];
            /** @description 현재(supersede되지 않은) generated_block id 목록. 지정 시 해당 블록은 protection_state=USER_LOCKED로 영속 기록되어 이후 모든 재생성에서 보호된다 (범위 지정 재생성 여부와 무관). 알 수 없는 id는 422 PLAN-422-002. */
            protectedBlockIds?: string[];
        };
        /**
         * @description 용도. 허용 MIME·크기 상한이 여기서 갈린다. CC-170이 실제로 처리하는 것은
         *     HWPX_IMPORT 하나이며 나머지는 각 항목(CC-220 등)에서 열린다 — 지금 보내면
         *     422 FILE-422-001이다. 어휘를 미리 두는 이유는 용도별 상한이 나중에 생기는
         *     분기가 아니라 처음부터 있어야 하는 축이기 때문이다.
         * @enum {string}
         */
        FileUploadPurpose: "HWPX_IMPORT" | "KNOWLEDGE_DOCUMENT" | "ATTACHMENT";
        /**
         * @description 사전등록(PENDING) → UNE-DOC-002 검증 성공(VERIFIED) 또는 실패(ABORTED).
         *     전송 완료를 별도 상태로 두지 않는다 — 검증하지 않은 "올라옴"은 이후 어떤
         *     결정의 근거도 되지 못하므로 도달 가능한 상태를 늘리기만 한다.
         * @enum {string}
         */
        FileUploadState: "PENDING" | "VERIFIED" | "ABORTED";
        /**
         * @description 악성코드 검사 상태. **AV 스캐너가 없으므로 현재 구현은 항상 PENDING이다**
         *     (OB-15). 검증을 통과한 파일도 "검사되지 않음"이 사실이며, 여기를 CLEAN으로
         *     올리면 감사 기록이 하지 않은 검사를 했다고 말한다.
         * @enum {string}
         */
        FileScanStatus: "PENDING" | "CLEAN" | "INFECTED";
        FileObjectResource: {
            /** Format: uuid */
            fileId: string;
            originalName: string;
            mimeType: string;
            /** Format: int64 */
            sizeBytes: number;
            /** @description PENDING에서는 클라이언트의 **선언값**, VERIFIED에서는 저장 바이트에서 재계산한 값이다. */
            sha256: string;
            uploadState: components["schemas"]["FileUploadState"];
            scanStatus: components["schemas"]["FileScanStatus"];
            /** Format: date-time */
            verifiedAt?: string | null;
            /** Format: uuid */
            createdBy: string;
            /** Format: date-time */
            createdAt: string;
        };
        FileUploadTicket: {
            /** @description 바이트를 그대로 PUT할 절대 URL. 서명이나 티켓이 쿼리에 실린다. */
            url: string;
            /** @enum {string} */
            method: "PUT";
            /** @description 전송 시 그대로 붙여야 하는 헤더. 서명 대상이므로 임의로 더하거나 빼면 실패한다. */
            headers: {
                [key: string]: string;
            };
            /** Format: date-time */
            expiresAt: string;
            /** Format: int64 */
            maxSizeBytes: number;
            /**
             * @description 진단·증거용이다. **클라이언트는 이 값으로 분기하지 않는다** — 그래야
             *     로컬(인메모리)과 MinIO/S3가 같은 화면 코드로 동작한다.
             * @enum {string}
             */
            driver: "PRESIGNED_S3" | "API_DIRECT";
        };
        FileRegistrationResource: {
            file: components["schemas"]["FileObjectResource"];
            upload: components["schemas"]["FileUploadTicket"];
        };
        FileRegisterRequest: {
            fileName: string;
            /** Format: int64 */
            sizeBytes: number;
            mimeType: string;
            sha256: string;
            purpose?: components["schemas"]["FileUploadPurpose"];
        };
        FileCompleteRequest: {
            /**
             * @description 전송 계층이 돌려준 ETag. **참고 기록일 뿐 무결성 근거가 아니다** —
             *     멀티파트 업로드의 ETag는 MD5가 아니고 드라이버마다 다르다. 근거는
             *     서버가 저장 바이트에서 다시 계산한 SHA-256이다.
             */
            etag?: string;
        };
        FileRegistrationResponse: {
            success: boolean;
            data: components["schemas"]["FileRegistrationResource"];
            meta: components["schemas"]["Meta"];
        };
        FileObjectResponse: {
            success: boolean;
            data: components["schemas"]["FileObjectResource"];
            meta: components["schemas"]["Meta"];
        };
        DocumentAnalysisSummary: {
            /** Format: uuid */
            templateProfileId: string;
            profileVersion: number;
            /**
             * @description 문서 단위 판정(ADR v1.1 §8.6 G15-1, 롤업 규칙은 ADR-29 D2).
             *     `template_profile.analysis_status`에 그대로 저장된다 — ADR-31 D12가
             *     이 컬럼을 판정 축으로 확정했으므로 변환하지 않는다.
             * @enum {string}
             */
            verdict: "AUTO" | "CONFIRM" | "LIMITED" | "REJECT";
            confidence: number;
            objectCounts: {
                NATIVE_EDIT: number;
                PRESERVE_ONLY: number;
                FLATTEN_EXPORT_ONLY: number;
                REJECT: number;
            };
            prototypeCount: number;
            unsupportedObjectCount: number;
            warnings: string[];
            analysisHash: string;
            /** @description 분석 소요 시간. 성능 기준선(ADR G15-5) 관측점이다. */
            elapsedMs?: number;
        };
        ImportedDocumentResource: {
            /** Format: uuid */
            documentId: string;
            /** Format: uuid */
            planId?: string | null;
            title: string;
            /** @enum {string} */
            documentType: "PLAN" | "JOURNAL";
            /** @enum {string} */
            status: "EDITING" | "REVIEW" | "APPROVED";
            /** Format: uuid */
            sourceFileId: string;
            /** Format: uuid */
            revisionId: string;
            revisionNo: number;
            irHash: string;
            analysis: components["schemas"]["DocumentAnalysisSummary"];
        };
        HwpImportResponse: {
            success: boolean;
            data: components["schemas"]["ImportedDocumentResource"];
            meta: components["schemas"]["Meta"];
        };
        DocumentAnalysisResource: {
            /** Format: uuid */
            documentId: string;
            analysis: components["schemas"]["DocumentAnalysisSummary"];
            /** @description NATIVE_EDIT가 아닌 객체의 분류 결과. 어떤 객체가 저장을 차단하는지의 근거다(ADR-29 D4, ADR-31 D7). */
            unsupportedObjects: ({
                /** @enum {string} */
                objectClass: "PRESERVE_ONLY" | "FLATTEN_EXPORT_ONLY" | "REJECT";
                elementName: string;
                locator?: string;
                reason?: string;
            } & {
                [key: string]: unknown;
            })[];
            /**
             * @description TemplateProfile 전문. 정본 스키마는
             *     `contracts/schemas/template-profile.schema.json`이며 여기서는 통과시킨다.
             */
            profile: {
                [key: string]: unknown;
            };
            /** Format: date-time */
            createdAt: string;
        };
        DocumentAnalysisResponse: {
            success: boolean;
            data: components["schemas"]["DocumentAnalysisResource"];
            meta: components["schemas"]["Meta"];
        };
        HwpImportRequest: {
            /**
             * Format: uuid
             * @description UNE-DOC-002를 통과한(uploadState=VERIFIED) 파일이어야 한다.
             */
            fileId: string;
            /**
             * Format: uuid
             * @description 주면 plan.document_id에 이 문서가 기록된다(ADR-32 D9). 이미 문서를 가진 계획서는 409, 다른 테넌트·삭제된 계획서는 404다.
             */
            planId?: string | null;
            /** @description 생략하면 원본 파일명을 쓴다. */
            title?: string;
        };
        /**
         * @description 일반 편집은 `operations`가 필수다. **Undo/Redo는 반대로 `operations`를 싣지
         *     않는다** — `undoesChangeSetId`로 되돌릴 ChangeSet만 지목하면 서버가 저장해 둔
         *     역연산을 쓴다(ADR-30 D6 보정). 역연산은 원본 블록 IR을 통째로 나르므로, 요청
         *     표면에서 받으면 클라이언트가 origin:'SOURCE'·위조 앵커·locked 노드를 문서에
         *     직접 심을 수 있다.
         */
        ChangeSetRequest: {
            /**
             * Format: uuid
             * @description If-Match가 가리키는 Revision과 같아야 한다(다르면 422 DOC-422-004).
             */
            baseRevisionId: string;
            origin: components["schemas"]["ChangeSetOrigin"];
            operations?: components["schemas"]["ChangeOperation"][];
            /** @description 문서 범위 멱등 앵커(uk_change_set_mutation). */
            clientMutationId: string;
            /**
             * @description 검증·Diff만 수행하고 리비전을 만들지 않는다.
             * @default false
             */
            dryRun: boolean;
            /**
             * Format: uuid
             * @description 되돌릴 ChangeSet(change_set.undoes_change_set_id). 이 값을 실으면 origin은
             *     UNDO 또는 REDO여야 하고 operations를 실을 수 없다. 대상 이후 같은 노드를
             *     건드린 ChangeSet이 있으면 422 DOC-422-004(UNDO_CONFLICT)다.
             */
            undoesChangeSetId?: string;
            checkpointLabel?: string;
            changeSummary?: string;
        } & unknown;
        /** @enum {string} */
        ChangeSetOrigin: "USER" | "AI" | "AUTOSAVE" | "UNDO" | "REDO" | "RESTORE" | "MATERIALIZE";
        /**
         * @description 설계 07 §1.9가 고정한 8종. ADR 없이 늘어나지 않는다(ck_change_operation_type).
         * @enum {string}
         */
        ChangeOperationType: "INSERT_BLOCKS" | "REPLACE_RANGE" | "DELETE_RANGE" | "SPLIT_PARAGRAPH" | "MERGE_PARAGRAPHS" | "MOVE_BLOCK" | "APPLY_STYLE_ROLE" | "TABLE_PATCH";
        TextPosition: {
            paragraphId: string;
            /** @description 문단 run 텍스트를 이은 문자열에 대한 UTF-16 코드 단위 인덱스(§1.8). */
            offset: number;
        };
        /** @description 화면좌표와 원시 XML 앵커를 담는 필드가 없다(§1.8-4). 종류별 필수 항목은 contracts/schemas/change-set.schema.json이 oneOf로 닫는다. */
        SelectionEnvelope: {
            /** @enum {string} */
            kind: "CURSOR" | "TEXT_RANGE" | "BLOCK" | "SECTION" | "TABLE_CELL";
            /** Format: uuid */
            baseRevisionId: string;
            at?: components["schemas"]["TextPosition"];
            start?: components["schemas"]["TextPosition"];
            end?: components["schemas"]["TextPosition"];
            blockIds?: string[];
            sectionId?: string;
            tableId?: string;
            cellId?: string;
        };
        BlockAnchor: {
            /** @enum {string} */
            relation: "BEFORE" | "AFTER" | "FIRST_CHILD" | "LAST_CHILD";
            /** @description 기준 노드의 안정 ID(원시 XML 앵커가 아니다). */
            ref: string;
        };
        /** @description INSERT_BLOCKS의 블록 출처. GENERATED_BLOCKS가 materialize 경로이며 서버가 3중 방어(현재 목차버전 일치, superseded_at IS NULL, 보호 블록 제외)를 건다. */
        InsertSource: {
            /** @enum {string} */
            kind: "INLINE" | "PROTOTYPE" | "GENERATED_BLOCKS";
            blocks?: {
                [key: string]: unknown;
            }[];
            prototypeId?: string;
            count?: number;
            /** Format: uuid */
            planId?: string;
            /** Format: uuid */
            tocVersionId?: string;
        };
        ChangeOperation: {
            type: components["schemas"]["ChangeOperationType"];
            /** @description ChangeSet 안에서 유일해야 한다(uk_change_operation_order). */
            order: number;
            selection?: components["schemas"]["SelectionEnvelope"];
            anchor?: components["schemas"]["BlockAnchor"];
            source?: components["schemas"]["InsertSource"];
            payload?: {
                [key: string]: unknown;
            };
        };
        DiffEntry: {
            /** @enum {string} */
            kind: "ADDED" | "REMOVED" | "MODIFIED" | "MOVED";
            nodeId: string;
            /** @description 짧은 텍스트 미리보기. 본문이므로 로그·목록에는 싣지 않는다. */
            preview?: string;
        };
        NodeAlias: {
            from: string;
            to: string;
            /** @description MERGE는 오른쪽 문단의 모든 오프셋을 왼쪽 길이만큼 민다. 이 값이 없으면 재조회가 노드는 맞히고 문자 위치는 틀린다. */
            offsetDelta: number;
        };
        MaterializeReport: {
            /** Format: uuid */
            planId: string;
            /** Format: uuid */
            tocVersionId: string;
            candidateBlocks: number;
            insertedBlocks: number;
            /** @description 제외된 블록과 사유. 조용히 빠지면 사용자는 문서가 왜 비었는지 모른다. */
            excluded: {
                /** Format: uuid */
                blockId: string;
                nodeKey: string;
                reason: string;
            }[];
        };
        ChangeSetResult: {
            /**
             * Format: uuid
             * @description dryRun이면 null(아무 행도 쓰지 않았다).
             */
            changeSetId: string | null;
            /** Format: uuid */
            documentId: string;
            /** Format: uuid */
            baseRevisionId: string;
            dryRun: boolean;
            applied: boolean;
            /** @description 같은 clientMutationId 재전송으로 원래 결과를 돌려준 경우 true. */
            replayed: boolean;
            /** Format: uuid */
            newRevisionId: string | null;
            newRevisionNo: number | null;
            irHash: string;
            diff: components["schemas"]["DiffEntry"][];
            /** @description Undo가 재유도가 아니라 자료 조회가 되도록 저장된 역연산(ADR-30 D6). */
            inverseOperations: components["schemas"]["ChangeOperation"][];
            aliases: components["schemas"]["NodeAlias"][];
            /** @description 이번 ChangeSet이 무효화한 alias(MERGE 되돌림으로 되살아난 문단). */
            aliasRemovals: components["schemas"]["NodeAlias"][];
            warnings: string[];
            materialize: components["schemas"]["MaterializeReport"] | null;
        };
        ChangeSetResultResponse: {
            success: boolean;
            data: components["schemas"]["ChangeSetResult"];
            meta: components["schemas"]["Meta"];
        };
        DocumentIrResource: {
            /** Format: uuid */
            documentId: string;
            /** Format: uuid */
            revisionId: string;
            revisionNo: number;
            irHash: string;
            origin: components["schemas"]["RevisionOrigin"];
            checkpointLabel: string | null;
            /** Format: uuid */
            headRevisionId: string;
            headRevisionNo: number;
            /** @enum {string} */
            irVersion: "1" | "2";
            /** @description 저장된 ir_json이 v1이라 읽기 시 v2로 승격했는가(ADR-30 D3). */
            liftedFromV1: boolean;
            /** @description contracts/schemas/document-ir.schema.json이 정본이다. */
            ir: {
                [key: string]: unknown;
            };
            /** Format: uuid */
            createdBy: string;
            /** Format: date-time */
            createdAt: string;
        };
        DocumentIrResponse: {
            success: boolean;
            data: components["schemas"]["DocumentIrResource"];
            meta: components["schemas"]["Meta"];
        };
        /**
         * @description 리비전이 어떤 기제로 만들어졌는가(ck_document_revision_origin). ChangeSet의 출처(누가 요청했나)와 축이 다르다 — USER/AI 편집은 둘 다 CHANGESET이다.
         * @enum {string}
         */
        RevisionOrigin: "IMPORT" | "MATERIALIZE" | "CHANGESET" | "AUTOSAVE" | "UNDO" | "REDO" | "RESTORE";
        RevisionResource: {
            /** Format: uuid */
            revisionId: string;
            /** Format: uuid */
            documentId: string;
            revisionNo: number;
            /** Format: uuid */
            parentRevisionId: string | null;
            irHash: string;
            changeSummary: string | null;
            origin: components["schemas"]["RevisionOrigin"];
            /** @description 자동/수동 checkpoint 라벨. 어휘가 정본에서 닫혀 있지 않아 enum이 아니다. */
            checkpointLabel: string | null;
            isHead: boolean;
            /** Format: uuid */
            createdBy: string;
            /** Format: date-time */
            createdAt: string;
        };
        RevisionPageResponse: {
            success: boolean;
            data: {
                items: components["schemas"]["RevisionResource"][];
                page: number;
                size: number;
                totalElements: number;
                totalPages: number;
                /** Format: uuid */
                headRevisionId: string | null;
                headRevisionNo: number | null;
            };
            meta: components["schemas"]["Meta"];
        };
        RevisionRestoreRequest: {
            reason?: string;
            checkpointLabel?: string;
        };
        RevisionRestoreResponse: {
            success: boolean;
            data: {
                revision: components["schemas"]["RevisionResource"];
                /** Format: uuid */
                changeSetId: string;
                /** Format: uuid */
                restoredFromRevisionId: string;
                restoredFromRevisionNo: number;
            };
            meta: components["schemas"]["Meta"];
        };
        AutosaveRequest: {
            /** Format: uuid */
            baseRevisionId: string;
            delta: {
                operations: components["schemas"]["ChangeOperation"][];
            };
            clientMutationId: string;
            /** @description 클라이언트 큐 순번. 생략하면 서버가 문서별 다음 값을 쓴다. 하한이 0인 이유는 0-based/1-based를 정하는 정본이 없기 때문이다(0019 §6). */
            seq?: number;
        };
        AutosaveReceipt: {
            /** Format: uuid */
            autosaveId: string;
            /** Format: uuid */
            documentId: string;
            clientMutationId: string;
            /** @description bigint이므로 문자열로 나간다(정밀도 보존). */
            seq: string;
            /** @enum {string} */
            status: "ACCEPTED" | "CONFLICT" | "SUPERSEDED";
            /** Format: uuid */
            baseRevisionId: string;
            /** Format: uuid */
            resultRevisionId: string | null;
            resultRevisionNo: number | null;
            irHash: string | null;
            replayed: boolean;
            /** Format: date-time */
            receivedAt: string;
        };
        AutosaveReceiptResponse: {
            success: boolean;
            data: components["schemas"]["AutosaveReceipt"];
            meta: components["schemas"]["Meta"];
        };
        RevisionConflictEnvelope: {
            /** @enum {boolean} */
            success: false;
            error: components["schemas"]["Error"];
            meta: components["schemas"]["Meta"] & {
                /** @description 복구 정보. 이것이 없는 409는 클라이언트가 쓸 수 없다 — 최신 Revision을 다시 조회할 좌표가 응답 안에 있어야 한다. */
                conflict: {
                    /** Format: uuid */
                    currentRevisionId: string;
                    currentRevisionNo: number;
                    headIrHash: string;
                };
            };
        };
        ExportRequest: {
            /** @enum {string} */
            format: "HWPX" | "PDF" | "DOCX";
            /** Format: uuid */
            revisionId?: string | null;
        };
        SituationCreateRequest: {
            mode: components["schemas"]["SituationMode"];
            title: string;
            hazardType: string;
            /** Format: date-time */
            occurredAt?: string | null;
            locationText?: string | null;
            /**
             * @deprecated
             * @description 설계 10 SIT 표의 요청 요약이 쓴 이름. `locationText`와 같은 컬럼 (`situation.location_text`)이며 둘 다 오면 `locationText`가 이긴다. 신규 클라이언트는 `locationText`를 쓸 것.
             */
            location?: string | null;
        };
        ProviderQueryRequest: {
            providers: ("KMA" | "MOIS" | "SAFEKOREA" | "NAVER" | "T3Q")[];
            /** @description Provider별 해석이 다른 조회조건. 도메인은 들여다보지 않고 어댑터에 전달만 한다(예: `adminCode`). */
            query: Record<string, never>;
            /** @description 조회할 Fact 범주(설계 01 §20.5). 생략·빈 배열이면 제한 없음. */
            categories?: components["schemas"]["SituationFactType"][];
            /** @description 보조 Provider 활성화(설계 10 SIT-005 "핵심 요청: providers,query, featureFlags"). 기본값은 전부 false다 — SafeKorea/Naver는 법적·운영 승인 전(OB-05)이고 T3Q 상황 API는 승인된 계약이 없다(OB-02). 켜도 어댑터가 없으면 NOT_CONTRACTED로 답하지 성공한 척하지 않는다. */
            featureFlags?: {
                safekorea?: boolean;
                naver?: boolean;
                t3q?: boolean;
            };
            requestReason?: string | null;
            /** Format: date-time */
            from?: string | null;
            /** Format: date-time */
            to?: string | null;
        };
        SituationPatchRequest: {
            title?: string;
            hazardType?: string;
            /** Format: date-time */
            occurredAt?: string | null;
            locationText?: string | null;
        };
        SituationFactCreateRequest: {
            factType: components["schemas"]["SituationFactType"];
            factKey: string;
            value: unknown;
            unit?: string | null;
            /**
             * Format: date-time
             * @description 명시적 오프셋이 필요하다. 오프셋이 없으면 422로 거부한다.
             */
            observedAt?: string | null;
            confidence?: number | null;
            /** @description 사용자 입력의 출처. providerCode는 MANUAL로 고정되고 sourceType은 USER다 — 사용자가 공식 Provider를 사칭할 수 없다. */
            source?: {
                sourceName?: string;
                sourceUrl?: string | null;
            };
        };
        SituationFactPatchRequest: {
            value?: unknown;
            unit?: string | null;
            /** Format: date-time */
            observedAt?: string | null;
            confidence?: number | null;
            /** @description 보정 사유. **필수다** — CC-210부터 보정은 파생 Fact를 만들고 (설계 06 US-SIT-007 #3) 파생은 actor·사유 없이 만들 수 없다 (0025 §2 ck_situation_fact_derivation_shape). */
            reason: string;
        };
        SituationSnapshotCreateRequest: {
            /**
             * Format: uuid
             * @description 요청자가 보고 있던 **직전 확정 판**. 첫 확정이면 `null`을 명시한다. 현재 `situation.current_snapshot_id`와 다르면 409 `SIT-409-004`다 — 그 사이의 확정을 보지 못했다는 뜻이므로 최신 판을 검토한 뒤 다시 확정해야 한다(설계 06 US-SIT-008 E-01 REVISION_CONFLICT, ADR-34 D17). **생략할 수 없다** — 생략을 허용하면 가드가 우회된다.
             */
            expectedSnapshotId: string | null;
            factIds: string[];
            /** Format: date-time */
            effectiveAt: string;
            reason?: string | null;
        };
        DeduplicateRequest: {
            strategy?: components["schemas"]["DuplicateStrategy"];
            /** @description 지금 두 전략은 쓰지 않지만 값을 버리지 않고 그대로 기록한다. */
            threshold?: number | null;
            /** @description KEY_TIME_WINDOW의 창(분). 기본 60. */
            timeWindowMinutes?: number;
        };
        ConflictResolveRequest: {
            /**
             * Format: uuid
             * @description 이 충돌의 후보 중 하나여야 한다. 그 밖은 422다.
             */
            selectedFactId: string;
            /** @description 설계 06 US-SIT-007 완료조건("모든 선택에 actor/time/source 추적"). */
            reason: string;
        };
        KnowledgeDocumentCreateRequest: {
            /**
             * Format: uuid
             * @description UNE-DOC-002 업로드 검증을 통과한 file_object. 검증 전 파일은 KNOW-422-001.
             */
            fileId: string;
            /** @enum {string} */
            documentType: "MANUAL" | "TRAINING_PLAN" | "EVALUATION_GUIDE" | "MESSAGE_LIST" | "MISSION_CARD";
            /**
             * @description 보존범위(설계 06 US-SIT-009). ORG_KB는 등록 시점에 지정할 수 없다 — 5단계가 기관 KB 자동승격을 금지하고 A-02가 별도 승인 워크플로를 요구한다. 지정하면 KNOW-422-002.
             * @default THIS_INCIDENT
             * @enum {string}
             */
            retentionScope: "THIS_INCIDENT" | "PROJECT" | "ORG_KB";
            /**
             * @description 같은 해시의 자료가 이미 있어도 새로 등록한다(US-SIT-009 A-01). false이면 중복 시 KNOW-409-001로 기존 자료를 알려주고 사용자가 고른다.
             * @default false
             */
            force: boolean;
            metadata?: {
                [key: string]: unknown;
            };
        };
        KnowledgeDocumentResponse: {
            success: boolean;
            data: components["schemas"]["KnowledgeDocument"];
            meta: Record<string, never>;
        };
        KnowledgeDocumentRetryRequest: {
            /** @description 재시도 사유. 감사 기록의 핵심이므로 필수다. */
            reason: string;
        };
        /** @description 지식문서. **상태가 두 축이다** — `status`는 UNE가 아는 사실(파일을 검증했고 UNI에 보냈다), `uniStatus`는 UNI가 알려준 사실(파싱·색인·참조생성이 어디까지 갔다)이다. 설계 06이 US-SIT-009와 US-SIT-010에 서로 다른 상태전이를 적었고, 한 컬럼에 합치면 UNI가 응답하지 않을 때 무엇이 참인지 말할 수 없다. */
        KnowledgeDocument: {
            /** Format: uuid */
            knowledgeDocumentId: string;
            /** Format: uuid */
            situationId?: string | null;
            /** Format: uuid */
            fileId: string;
            /** @enum {string} */
            documentType: "MANUAL" | "TRAINING_PLAN" | "EVALUATION_GUIDE" | "MESSAGE_LIST" | "MISSION_CARD";
            /** @enum {string} */
            retentionScope: "THIS_INCIDENT" | "PROJECT" | "ORG_KB";
            /**
             * @description UNE 등록 축 (설계 06 US-SIT-009 상태전이).
             * @enum {string}
             */
            status: "PENDING_UPLOAD" | "UPLOADING" | "REGISTERED" | "FAILED" | "CANCELLED";
            /**
             * @description UNI 처리 축 (설계 08 §1.9 어휘). **null은 "아직 모른다"이지 "처리되지 않았다"가 아니다** — UNI가 doc_id를 돌려주기 전까지 null이다.
             * @enum {string|null}
             */
            uniStatus: "QUEUED" | "PARSING" | "INDEXING" | "REFERENCE_GENERATING" | "READY" | "ERROR" | null;
            /**
             * Format: date-time
             * @description uniStatus를 마지막으로 관측한 시각. 이 API는 UNI를 호출하지 않는다.
             */
            uniObservedAt?: string | null;
            /** @description UNI doc_id. REGISTERED이면 반드시 있다. */
            providerDocumentId?: string | null;
            /** @description SOP 근거로 쓸 수 있는가. status=REGISTERED이고 uniStatus=READY일 때만 참이다 (US-SIT-010 완료조건 "READY 아닌 자료가 Evidence에 포함된 건 0"). */
            evidenceEligible: boolean;
            /** @description 참조요약 없이도 검색 가능한가 (US-SIT-010 A-01 READY_WITHOUT_REFERENCE). REFERENCE_GENERATING에서도 참이며 evidenceEligible과 갈린다. */
            searchable: boolean;
            sourceSha256?: string | null;
            attemptCount: number;
            /** Format: date-time */
            lastAttemptAt?: string | null;
            error?: {
                [key: string]: unknown;
            } | null;
            reference?: {
                [key: string]: unknown;
            } | null;
            metadata?: {
                [key: string]: unknown;
            };
            /** Format: uuid */
            createdBy: string;
            /** Format: date-time */
            createdAt: string;
            /** Format: date-time */
            updatedAt: string;
        };
        EvidenceSearchRequest: {
            /**
             * Format: uuid
             * @description 근거를 모을 기준 판. **요청이 명시한다** — 생략을 허용하면 서버가 "지금 최신"으로 채우게 되고 사용자가 본 판과 달라질 수 있다. EvidenceSet은 동결되므로 그 어긋남이 그대로 굳는다(ADR-34 D17과 같은 이유). 현재 판이 아니면 409 EVID-409-002.
             */
            snapshotId: string;
            /** @description 검색어. 서버가 개인정보를 줄인 뒤 UNI로 보내고 줄인 값을 저장한다 (US-SIT-011 1단계). 완전한 익명화는 아니다(ADR-37 수용 한계). */
            query: string;
            filters?: {
                [key: string]: unknown;
            };
            /**
             * @description 설계 06 US-SIT-011 2단계의 기본값 8.
             * @default 8
             */
            topK: number;
        };
        EvidenceLockRequest: {
            /** @description 동결은 되돌릴 수 없으므로 사유가 감사의 핵심이다. */
            reason: string;
        };
        EvidenceItem: {
            /** Format: uuid */
            evidenceItemId: string;
            /**
             * Format: uuid
             * @description 우리가 올린 문서만 가리킨다. UNI가 모르는 문서를 주면 버린다(US-SIT-011 E-02).
             */
            knowledgeDocumentId: string;
            providerChunkId?: string | null;
            rankNo: number;
            /** @description UNI가 준 점수. **척도가 미확인이라 정규화하지 않는다**(OB-13). 동결 해시에도 넣지 않는다 — 재현되지 않는 값이면 내용이 같은 두 EvidenceSet의 해시가 달라진다. */
            score?: number | null;
            quote: string;
            sourceLocator?: {
                [key: string]: unknown;
            };
            citationKey: string;
            /** @description 제외한 후보도 행은 남는다(US-SIT-011 4단계). 제외에는 사유가 필요하다. */
            isSelected: boolean;
            excludedReason?: string | null;
        };
        /** @description 생성 시점에 동결되는 근거 묶음. 상태는 DRAFT/FROZEN 둘뿐이다 — US-SIT-011이 말하는 SEARCHING·RESULTS_READY 등은 **화면이 지금 무엇을 하는가**이지 저장할 사실이 아니다(ADR-37 D1). FROZEN 이후에는 집합도 항목도 바뀌지 않는다(0031 트리거). */
        EvidenceSet: {
            /** Format: uuid */
            evidenceSetId: string;
            /** Format: uuid */
            situationId: string;
            /** Format: uuid */
            snapshotId: string;
            query: string;
            filters?: {
                [key: string]: unknown;
            };
            topK: number;
            /** @enum {string} */
            status: "DRAFT" | "FROZEN";
            /** @description 동결 대상의 내용 해시. 점수·동결자·시각은 넣지 않는다. */
            contentHash: string;
            /** Format: date-time */
            frozenAt?: string | null;
            /** Format: uuid */
            frozenBy?: string | null;
            freezeReason?: string | null;
            /** @description UNI가 돌려줬으나 우리 문서가 아니어서 버린 청크 수. 조용히 버리면 결과가 적은 이유를 설명할 수 없다(US-SIT-011 E-02). */
            rejectedChunkCount: number;
            items: components["schemas"]["EvidenceItem"][];
            /** Format: uuid */
            createdBy: string;
            /** Format: date-time */
            createdAt: string;
            /** Format: date-time */
            updatedAt: string;
        };
        EvidenceSetResponse: {
            success: boolean;
            data: components["schemas"]["EvidenceSet"];
            meta: Record<string, never>;
        };
        SourceLocator: {
            /** Format: uuid */
            evidenceItemId: string;
            /** Format: uuid */
            knowledgeDocumentId: string;
            providerDocumentId?: string;
            fileName: string;
            providerChunkId?: string | null;
            citationKey: string;
            quote: string;
            locator?: {
                [key: string]: unknown;
            };
        };
        SourceLocatorResponse: {
            success: boolean;
            data: components["schemas"]["SourceLocator"];
            meta: Record<string, never>;
        };
        SopGenerationRequest: {
            /** Format: uuid */
            snapshotId: string;
            /** Format: uuid */
            evidenceSetId: string;
            /** @enum {string} */
            schemaVersion: "1.0";
        };
        SopCreateRequest: {
            /** Format: uuid */
            situationId?: string | null;
            title: string;
            hazardType: string;
        };
        /** @description See 03_json-schema/sop-graph.schema.json */
        SopGraph: {
            [key: string]: unknown;
        };
        SopRunCreateRequest: {
            /** Format: uuid */
            approvedVersionId: string;
            /** Format: uuid */
            snapshotId: string;
            /** @enum {string} */
            mode: "LIVE" | "EXERCISE" | "DRY_RUN";
            /** @enum {string} */
            startPolicy?: "AUTO" | "MANUAL";
        };
        TaskActionRequest: {
            [key: string]: unknown;
        };
        JournalProjectionRequest: {
            /** Format: uuid */
            snapshotId: string;
            /** Format: date-time */
            from: string;
            /** Format: date-time */
            to: string;
            /** Format: uuid */
            templateId?: string | null;
        };
        EvaluationRequest: {
            criteria: Record<string, never>[];
            comments?: string | null;
        };
        Plan: {
            [key: string]: unknown;
        };
        GenerationJob: {
            [key: string]: unknown;
        };
        /**
         * @description 설계 06 §7.1 / 0023 ck_situation_mode
         * @enum {string}
         */
        SituationMode: "LIVE" | "EXERCISE";
        /**
         * @description 설계 06 §7.1 Incident 상태 흐름 / 0023 ck_situation_status
         * @enum {string}
         */
        SituationStatus: "DRAFT" | "REGISTERED" | "CONTEXT_CONFIRMED" | "SOP_READY" | "RUNNING" | "PAUSED" | "CLOSING" | "CLOSED";
        /**
         * @description 설계 06 §7.1 SituationContext 상태. **컬럼이 아니라 파생값**이다 (0023 §8). 동기 수집에서 PROVIDER_QUERYING은 관측되지 않으므로 CC-200의 응답에는 나타나지 않는다(ADR-33 D2).
         * @enum {string}
         */
        SituationContextState: "DRAFT" | "PROVIDER_QUERYING" | "CANDIDATE_REVIEW" | "CONFLICT_OPEN" | "USER_CONFIRMED";
        /**
         * @description 설계 01 §20.5 "필수 Fact 범주"
         * @enum {string}
         */
        SituationFactType: "WEATHER_OBSERVATION" | "WEATHER_FORECAST" | "WEATHER_WARNING" | "DISASTER_MESSAGE" | "FIELD_REPORT" | "USER_ASSERTED";
        /**
         * @description 0023 + **0025**의 ck_situation_fact_status. `SUPERSEDED`는 보정이 파생 Fact를 만들면서 원본이 내려가는 자리다(ADR-34 D3). 마이그레이션만 넓히고 여기를 두면 삼중 대조가 갈라진다.
         * @enum {string}
         */
        SituationFactStatus: "CANDIDATE" | "CONFIRMED" | "REJECTED" | "SUPERSEDED";
        /**
         * @description situation-fact.schema.json source.providerCode enum과 같은 일곱 값
         * @enum {string}
         */
        ProviderCode: "KMA" | "MOIS" | "SAFEKOREA" | "NAVER" | "MANUAL" | "T3Q" | "UNI";
        Situation: {
            /** Format: uuid */
            situationId: string;
            /** Format: uuid */
            tenantId: string;
            mode: components["schemas"]["SituationMode"];
            title: string;
            /** @description 재난유형. 정본은 plan-context.schema.json의 enum이다(ADR-23 D3). */
            hazardType: string;
            status: components["schemas"]["SituationStatus"];
            /**
             * Format: date-time
             * @description 발생시각. 미정이면 null (설계 06 US-SIT-003 A-01).
             */
            occurredAt?: string | null;
            locationText?: string | null;
            /**
             * Format: uuid
             * @description 확정 SituationSnapshot. CC-200에서는 항상 null (확정은 CC-210).
             */
            currentSnapshotId?: string | null;
            /** @description 낙관적 잠금 버전 (If-Match/ETag 값) */
            versionNo: number;
            /** Format: uuid */
            createdBy: string;
            /** Format: date-time */
            createdAt: string;
            /** Format: date-time */
            updatedAt: string;
        };
        SituationDetail: {
            /** Format: uuid */
            situationId: string;
            /** Format: uuid */
            tenantId: string;
            mode: components["schemas"]["SituationMode"];
            title: string;
            hazardType: string;
            status: components["schemas"]["SituationStatus"];
            /** Format: date-time */
            occurredAt?: string | null;
            locationText?: string | null;
            /** Format: uuid */
            currentSnapshotId?: string | null;
            versionNo: number;
            /** Format: uuid */
            createdBy: string;
            /** Format: date-time */
            createdAt: string;
            /** Format: date-time */
            updatedAt: string;
            contextState: components["schemas"]["SituationContextState"];
            /** @description status=CANDIDATE인 Fact 수. contextState의 근거값이다. */
            candidateFactCount: number;
            /** @description OPEN 충돌 수. CC-200에서는 항상 0 (충돌 계산은 CC-210). */
            openConflictCount: number;
        };
        SituationFactSource: {
            /** Format: uuid */
            sourceId: string;
            providerCode: components["schemas"]["ProviderCode"];
            /** @enum {string} */
            sourceType: "API" | "WEB" | "FILE" | "USER";
            sourceName: string;
            sourceUrl?: string | null;
            /**
             * Format: date-time
             * @description fact_source.retrieved_at (조회시각)
             */
            collectedAt: string;
        };
        FactNormalization: {
            version: string;
            /** @enum {string} */
            outcome: "NORMALIZED" | "ORIGINAL_KEPT";
            originalValue?: unknown;
            originalUnit?: string | null;
            notes?: {
                reason: string;
                detail: string;
            }[];
        };
        SituationFact: {
            /** Format: uuid */
            factId: string;
            /** Format: uuid */
            situationId: string;
            factType: components["schemas"]["SituationFactType"];
            /** @description 표준 Key. 패턴은 situation-fact.schema.json과 같다. */
            factKey: string;
            value: unknown;
            unit?: string | null;
            source: components["schemas"]["SituationFactSource"];
            /** Format: date-time */
            observedAt?: string | null;
            /** Format: date-time */
            collectedAt: string;
            confidence?: number | null;
            status: components["schemas"]["SituationFactStatus"];
            normalization?: components["schemas"]["FactNormalization"];
            /**
             * Format: uuid
             * @description 파생 원본(0025 §2). 원천이면 null이다. 보정은 제자리 수정이 아니라 파생 생성이므로 화면이 계보를 그릴 수 있어야 한다(ADR-34 D3).
             */
            originalFactId: string | null;
            derivedReason?: string | null;
            versionNo: number;
            /** Format: date-time */
            updatedAt: string;
        };
        ProviderJob: {
            /** Format: uuid */
            providerJobId: string;
            /** Format: uuid */
            batchId: string;
            /** Format: uuid */
            situationId?: string | null;
            providerCode: components["schemas"]["ProviderCode"];
            /**
             * @description 0028(CC-220)이 QUEUED/RUNNING을 열었다 — 0023 §4가 "비동기로 옮길 때 함께 온다"고 예고한 값이다. 상황 수집(CC-200)은 여전히 동기라 종결 상태로만 태어나고, 미종결 두 값은 UNI 지식문서 전송 경로가 쓴다.
             * @enum {string}
             */
            status: "QUEUED" | "RUNNING" | "SUCCEEDED" | "PARTIAL" | "FAILED";
            /** @description 정규화를 통과해 후보 Fact가 된 항목 수 */
            resultCount: number;
            /** @description 실패·부분실패의 근거. 0023 ck_provider_job_outcome_shape가 상태와의 상관을 강제한다: SUCCEEDED면 null, PARTIAL이면 non-null이고 resultCount>0, FAILED면 non-null이고 resultCount=0. */
            error?: {
                /** @enum {string} */
                kind?: "TIMEOUT" | "UNAUTHORIZED" | "RATE_LIMITED" | "UPSTREAM_ERROR" | "PARSER_CHANGED" | "NO_DATA" | "DISABLED" | "NOT_CONTRACTED" | "NORMALIZATION_REJECTED";
                message?: string;
                retriable?: boolean;
                /** @description 정규화에서 탈락한 항목 수 (PARTIAL의 근거) */
                rejectedCount?: number;
                /** @description 탈락 사유의 중복 제거 목록(도메인 NormalizationReason). 탈락 항목의 원문 자체는 provider_result에 통째로 있다. */
                reasons?: string[];
            } | null;
            correlationId?: string;
            /** Format: date-time */
            createdAt: string;
            /**
             * Format: date-time
             * @description 미종결(QUEUED/RUNNING)이면 null이다. 종결 상태에는 0028의 ck_provider_job_outcome_shape가 값을 강제한다 — 불변식이 컬럼 NOT NULL에서 상관식으로 옮겨갔을 뿐 약해지지 않는다.
             */
            finishedAt: string | null;
        };
        ProviderQueryJob: {
            /** Format: uuid */
            batchId: string;
            /** Format: uuid */
            situationId: string;
            jobs: components["schemas"]["ProviderJob"][];
            /** @description 이 요청이 만든 후보 Fact 수 (모든 Provider 합계) */
            factsCreated: number;
        };
        SituationResponse: {
            success: boolean;
            data: components["schemas"]["Situation"];
            meta: Record<string, never>;
        };
        SituationDetailResponse: {
            success: boolean;
            data: components["schemas"]["SituationDetail"];
            meta: Record<string, never>;
        };
        SituationPageResponse: {
            success: boolean;
            data: {
                items: components["schemas"]["Situation"][];
                page: number;
                size: number;
                totalElements: number;
                totalPages: number;
            };
            meta: Record<string, never>;
        };
        SituationFactResponse: {
            success: boolean;
            data: components["schemas"]["SituationFact"];
            meta: Record<string, never>;
        };
        SituationFactPageResponse: {
            success: boolean;
            data: {
                items: components["schemas"]["SituationFact"][];
                page: number;
                size: number;
                totalElements: number;
                totalPages: number;
            };
            meta: Record<string, never>;
        };
        ProviderQueryJobResponse: {
            success: boolean;
            data: components["schemas"]["ProviderQueryJob"];
            meta: Record<string, never>;
        };
        DeduplicateResponse: {
            success: boolean;
            data: {
                groups: components["schemas"]["DuplicateGroup"][];
                /** @description 계산 후의 OPEN 충돌 전부(이번에 새로 연 것만이 아니다). */
                conflicts: components["schemas"]["FactConflict"][];
                /** @description 이번 계산이 **새로** 연 충돌 수. 기존 OPEN은 세지 않는다. */
                conflictsOpened: number;
                /** @description 이번 계산에 더 이상 나타나지 않아 OBSOLETE로 닫힌 충돌 수. 보정으로 값이 같아진 경우가 대표적이다. */
                conflictsObsoleted: number;
            };
            meta: Record<string, never>;
        };
        FactConflictListResponse: {
            success: boolean;
            data: components["schemas"]["FactConflict"][];
            meta: Record<string, never>;
        };
        ConflictResolutionResponse: {
            success: boolean;
            data: components["schemas"]["ConflictResolution"];
            meta: Record<string, never>;
        };
        SituationSnapshotResponse: {
            success: boolean;
            data: components["schemas"]["SituationSnapshot"];
            meta: Record<string, never>;
        };
        SituationSnapshotListResponse: {
            success: boolean;
            data: {
                /** @description 최신 버전부터. */
                items: components["schemas"]["SituationSnapshot"][];
                /** @description compareTo가 없으면 null. */
                diff: components["schemas"]["SnapshotDiff"] | null;
            };
            meta: Record<string, never>;
        };
        ProviderJobResponse: {
            success: boolean;
            data: components["schemas"]["ProviderJob"];
            meta: Record<string, never>;
        };
        SituationSnapshot: {
            /** Format: uuid */
            snapshotId: string;
            /** Format: uuid */
            situationId: string;
            /** @description 상황 안에서 유일하다(0025 §6). 재확정은 새 snapshotId + v+1. */
            versionNo: number;
            /** Format: date-time */
            effectiveAt: string;
            /** @description 확정 시점의 Fact 사본. 참조가 아니라 사본인 이유는 설계 06 A-02다 — 확정 후 원천이 바뀌어도 Snapshot은 움직이지 않아야 한다. */
            facts: components["schemas"]["SnapshotFact"][];
            /** @description 정규화 JSON의 SHA-256. 사실과 effectiveAt만 들어가고 확정자·시각· 사유·버전은 빠진다 — 그래야 "내용이 같은가"를 물을 수 있다. */
            contentHash: string;
            /** Format: uuid */
            supersedesSnapshotId?: string | null;
            /** Format: uuid */
            confirmedBy: string;
            /** Format: date-time */
            confirmedAt: string;
        };
        SnapshotFact: {
            /** Format: uuid */
            factId: string;
            factType: components["schemas"]["SituationFactType"];
            factKey: string;
            value: unknown;
            unit?: string | null;
            source: {
                providerCode: components["schemas"]["ProviderCode"];
                sourceName: string;
                sourceUrl?: string | null;
                /** Format: date-time */
                collectedAt: string;
            };
            /** Format: date-time */
            observedAt?: string | null;
            /** Format: date-time */
            collectedAt: string;
            confidence?: number | null;
            /**
             * @description 확정 시점의 상태를 박는다. 사본은 이후 UPDATE를 따라가지 않는다.
             * @enum {string}
             */
            status: "CONFIRMED";
        };
        DuplicateGroup: {
            /** Format: uuid */
            groupId: string;
            /** Format: uuid */
            situationId: string;
            factType: components["schemas"]["SituationFactType"];
            factKey: string;
            /** @description 전략이 만든 그룹화 키(범주+Key+시간창). 같은 상황 안에서 유일하다(0025 §1). **범주가 들어간다** — 빼면 범주가 다른 동명 Key가 한 그룹이 되어 허위 충돌이 열린다(ADR-34 D5 따름정리). */
            groupKey: string;
            strategy: components["schemas"]["DuplicateStrategy"];
            threshold?: number | null;
            /** @description 묶인 Fact. **원천은 각각 유지된다**(설계 06 US-SIT-006 */
            memberFactIds: string[];
            memberCount: number;
            /** Format: date-time */
            computedAt: string;
        };
        /**
         * @description 0025 §1 ck_fact_duplicate_group_strategy와 같은 어휘
         * @enum {string}
         */
        DuplicateStrategy: "KEY_TIME_WINDOW" | "KEY_ONLY";
        FactConflict: {
            /** Format: uuid */
            conflictId: string;
            /** Format: uuid */
            situationId: string;
            factKey: string;
            /**
             * @description VALUE(값이 다름) / TIME(값은 같고 시각이 다름) / SOURCE. **값도 시각도 같으면 충돌이 아니라 중복이다**(설계 06 US-SIT-006 #3).
             * @enum {string}
             */
            conflictType: "VALUE" | "TIME" | "SOURCE";
            /**
             * @description `OBSOLETE`는 재계산이 "더 이상 존재하지 않는 충돌"을 닫은 것이다 — 보정으로 값이 같아졌는데 OPEN으로 두면 확정이 영구 차단되고, RESOLVED로 적으면 하지 않은 선택을 기록하게 된다(ADR-34 D6).
             * @enum {string}
             */
            status: "OPEN" | "RESOLVED" | "OBSOLETE";
            /** @description 충돌의 단위는 그룹의 단위와 같다(0025 §4). */
            groupKey: string | null;
            candidateFactIds: string[];
            /** Format: date-time */
            detectedAt: string;
        };
        ConflictResolution: {
            /** Format: uuid */
            resolutionId: string;
            /** Format: uuid */
            conflictId: string;
            factKey: string;
            /** Format: uuid */
            selectedFactId: string;
            reason: string;
            /** Format: uuid */
            resolvedBy: string;
            /** Format: date-time */
            resolvedAt: string;
        };
        SnapshotDiff: {
            /** Format: uuid */
            fromSnapshotId: string;
            /** Format: uuid */
            toSnapshotId: string;
            added: number;
            removed: number;
            changed: number;
            unchanged: number;
            entries: {
                factKey: string;
                /** @enum {string} */
                kind: "ADDED" | "REMOVED" | "CHANGED" | "UNCHANGED";
                from?: components["schemas"]["SnapshotDiffSide"];
                to?: components["schemas"]["SnapshotDiffSide"];
            }[];
        };
        SnapshotDiffSide: {
            /** Format: uuid */
            factId: string;
            value?: unknown;
            unit?: string | null;
            /** Format: date-time */
            observedAt?: string | null;
        } | null;
        SopRun: {
            [key: string]: unknown;
        };
        Task: {
            [key: string]: unknown;
        };
        Journal: {
            [key: string]: unknown;
        };
        ExportJobResource: {
            /** Format: uuid */
            exportId: string;
            /** Format: uuid */
            documentId: string;
            /** Format: uuid */
            revisionId: string;
            /** @enum {string} */
            format: "HWPX" | "PDF" | "DOCX";
            /** @enum {string} */
            status: "QUEUED" | "RUNNING" | "COMPLETED" | "FAILED";
            /**
             * Format: uuid
             * @description COMPLETED에서만 채워진다 (0020 ck_export_job_terminal_shape)
             */
            outputFileId?: string | null;
            /** Format: uuid */
            validationReportId?: string | null;
            /** @description Track A 요약. UNE-DOC-013에서만 채워진다. */
            validation?: components["schemas"]["ValidationReportSummary"] | null;
            /** Format: uuid */
            requestedBy: string;
            /** Format: date-time */
            createdAt: string;
            /** Format: date-time */
            finishedAt?: string | null;
        };
        ValidationReportSummary: {
            /** Format: uuid */
            validationReportId: string;
            /** @enum {string} */
            track: "A_AUTO" | "B_HANCOM";
            /** @enum {string} */
            status: "PASS" | "LIMITED" | "FAIL";
            checks: {
                code: string;
                /** @enum {string} */
                layer?: "PACKAGE" | "REFERENCE" | "SEMANTIC" | "STYLE" | "VISUAL" | "HANCOM" | "EDIT";
                /** @enum {string} */
                outcome: "PASS" | "WARN" | "FAIL" | "NOT_RUN";
                detail: string;
                locator?: string;
            }[];
            notRunLayers: {
                /** @enum {string} */
                layer: "VISUAL" | "HANCOM" | "EDIT";
                reason: string;
            }[];
            outputSha256?: string;
            sourceSha256?: string;
        };
        ExportJobResponse: {
            success: boolean;
            data: components["schemas"]["ExportJobResource"];
            meta: Record<string, never>;
        };
    };
    responses: {
        /** @description Bad Request */
        BadRequest: {
            headers: {
                [name: string]: unknown;
            };
            content: {
                "application/json": components["schemas"]["ErrorEnvelope"];
            };
        };
        /** @description Unauthorized */
        Unauthorized: {
            headers: {
                [name: string]: unknown;
            };
            content: {
                "application/json": components["schemas"]["ErrorEnvelope"];
            };
        };
        /** @description Forbidden */
        Forbidden: {
            headers: {
                [name: string]: unknown;
            };
            content: {
                "application/json": components["schemas"]["ErrorEnvelope"];
            };
        };
        /** @description Not Found */
        NotFound: {
            headers: {
                [name: string]: unknown;
            };
            content: {
                "application/json": components["schemas"]["ErrorEnvelope"];
            };
        };
        /** @description Gone — 자원이 있었으나 더 이상 존재하지 않는다 */
        Gone: {
            headers: {
                [name: string]: unknown;
            };
            content: {
                "application/json": components["schemas"]["ErrorEnvelope"];
            };
        };
        /** @description Conflict */
        Conflict: {
            headers: {
                [name: string]: unknown;
            };
            content: {
                "application/json": components["schemas"]["ErrorEnvelope"];
            };
        };
        /** @description Unprocessable Entity */
        Unprocessable: {
            headers: {
                [name: string]: unknown;
            };
            content: {
                "application/json": components["schemas"]["ErrorEnvelope"];
            };
        };
        /** @description Precondition Failed */
        PreconditionFailed: {
            headers: {
                [name: string]: unknown;
            };
            content: {
                "application/json": components["schemas"]["ErrorEnvelope"];
            };
        };
        /** @description Precondition Required */
        PreconditionRequired: {
            headers: {
                [name: string]: unknown;
            };
            content: {
                "application/json": components["schemas"]["ErrorEnvelope"];
            };
        };
        /** @description Conflict (문서 Revision 충돌) */
        RevisionConflict: {
            headers: {
                /** @description 현재 head revision_no */
                ETag?: string;
                [name: string]: unknown;
            };
            content: {
                "application/json": components["schemas"]["RevisionConflictEnvelope"];
            };
        };
        /** @description Provider Error */
        ProviderError: {
            headers: {
                [name: string]: unknown;
            };
            content: {
                "application/json": components["schemas"]["ErrorEnvelope"];
            };
        };
    };
    parameters: {
        CorrelationId: string;
        IdempotencyKey: string;
        IdempotencyKeyRequired: string;
        IfMatch: string;
        IfMatchRequired: string;
        LastEventId: string;
    };
    requestBodies: never;
    headers: never;
    pathItems: never;
};
export type $defs = Record<string, never>;
export interface operations {
    une_auth_001: {
        parameters: {
            query?: never;
            header?: {
                "X-Correlation-Id"?: components["parameters"]["CorrelationId"];
                "Idempotency-Key"?: components["parameters"]["IdempotencyKey"];
            };
            path?: never;
            cookie?: never;
        };
        requestBody?: {
            content: {
                "application/json": components["schemas"]["SsoExchangeRequest"];
            };
        };
        responses: {
            /** @description Success */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["TokenResponse"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
            409: components["responses"]["Conflict"];
            422: components["responses"]["Unprocessable"];
            503: components["responses"]["ProviderError"];
        };
    };
    une_auth_002: {
        parameters: {
            query?: never;
            header?: {
                "X-Correlation-Id"?: components["parameters"]["CorrelationId"];
            };
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Success */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["GenericResponse"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
            409: components["responses"]["Conflict"];
            422: components["responses"]["Unprocessable"];
            503: components["responses"]["ProviderError"];
        };
    };
    une_auth_003: {
        parameters: {
            query?: never;
            header?: {
                "X-Correlation-Id"?: components["parameters"]["CorrelationId"];
                "Idempotency-Key"?: components["parameters"]["IdempotencyKey"];
            };
            path?: never;
            cookie?: never;
        };
        requestBody?: {
            content: {
                "application/json": components["schemas"]["GenericRequest"];
            };
        };
        responses: {
            /** @description Success */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["GenericResponse"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
            409: components["responses"]["Conflict"];
            422: components["responses"]["Unprocessable"];
            503: components["responses"]["ProviderError"];
        };
    };
    une_auth_004: {
        parameters: {
            query?: never;
            header?: {
                "X-Correlation-Id"?: components["parameters"]["CorrelationId"];
                "Idempotency-Key"?: components["parameters"]["IdempotencyKey"];
            };
            path?: never;
            cookie?: never;
        };
        requestBody?: {
            content: {
                "application/json": components["schemas"]["GenericRequest"];
            };
        };
        responses: {
            /** @description Success */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["GenericResponse"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
            409: components["responses"]["Conflict"];
            422: components["responses"]["Unprocessable"];
            503: components["responses"]["ProviderError"];
        };
    };
    une_auth_005: {
        parameters: {
            query?: never;
            header?: {
                "X-Correlation-Id"?: components["parameters"]["CorrelationId"];
            };
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Success */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["GenericResponse"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
            409: components["responses"]["Conflict"];
            422: components["responses"]["Unprocessable"];
            503: components["responses"]["ProviderError"];
        };
    };
    une_auth_006: {
        parameters: {
            query?: never;
            header?: {
                "X-Correlation-Id"?: components["parameters"]["CorrelationId"];
            };
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Success */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["GenericResponse"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
            409: components["responses"]["Conflict"];
            422: components["responses"]["Unprocessable"];
            503: components["responses"]["ProviderError"];
        };
    };
    une_auth_007: {
        parameters: {
            query?: never;
            header?: {
                "X-Correlation-Id"?: components["parameters"]["CorrelationId"];
            };
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Success */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["GenericResponse"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
            409: components["responses"]["Conflict"];
            422: components["responses"]["Unprocessable"];
            503: components["responses"]["ProviderError"];
        };
    };
    une_home_001: {
        parameters: {
            query?: never;
            header?: {
                "X-Correlation-Id"?: components["parameters"]["CorrelationId"];
            };
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Success */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["GenericResponse"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
            409: components["responses"]["Conflict"];
            422: components["responses"]["Unprocessable"];
            503: components["responses"]["ProviderError"];
        };
    };
    une_home_002: {
        parameters: {
            query?: never;
            header?: {
                "X-Correlation-Id"?: components["parameters"]["CorrelationId"];
            };
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Success */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["GenericResponse"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
            409: components["responses"]["Conflict"];
            422: components["responses"]["Unprocessable"];
            503: components["responses"]["ProviderError"];
        };
    };
    une_home_003: {
        parameters: {
            query?: never;
            header?: {
                "X-Correlation-Id"?: components["parameters"]["CorrelationId"];
                "Idempotency-Key"?: components["parameters"]["IdempotencyKey"];
            };
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody?: {
            content: {
                "application/json": components["schemas"]["GenericRequest"];
            };
        };
        responses: {
            /** @description Success */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["GenericResponse"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
            409: components["responses"]["Conflict"];
            422: components["responses"]["Unprocessable"];
            503: components["responses"]["ProviderError"];
        };
    };
    une_home_004: {
        parameters: {
            query?: never;
            header?: {
                "X-Correlation-Id"?: components["parameters"]["CorrelationId"];
                "Idempotency-Key"?: components["parameters"]["IdempotencyKey"];
            };
            path?: never;
            cookie?: never;
        };
        requestBody?: {
            content: {
                "application/json": components["schemas"]["GenericRequest"];
            };
        };
        responses: {
            /** @description Success */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["GenericResponse"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
            409: components["responses"]["Conflict"];
            422: components["responses"]["Unprocessable"];
            503: components["responses"]["ProviderError"];
        };
    };
    une_plan_002: {
        parameters: {
            query?: {
                /** @description 제목 부분일치 검색어 */
                keyword?: string;
                status?: components["schemas"]["PlanStatus"];
                hazardType?: components["schemas"]["PlanHazardType"];
                /** @description true이면 휴지통(deleted_at NOT NULL) 목록을 조회한다. */
                inTrash?: boolean;
                page?: number;
                size?: number;
            };
            header?: {
                "X-Correlation-Id"?: components["parameters"]["CorrelationId"];
            };
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Success */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["PlanPageResponse"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
            409: components["responses"]["Conflict"];
            422: components["responses"]["Unprocessable"];
            503: components["responses"]["ProviderError"];
        };
    };
    une_plan_001: {
        parameters: {
            query?: never;
            header: {
                "X-Correlation-Id"?: components["parameters"]["CorrelationId"];
                "Idempotency-Key": components["parameters"]["IdempotencyKeyRequired"];
            };
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["PlanCreateRequest"];
            };
        };
        responses: {
            /** @description Success */
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["PlanResponse"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
            409: components["responses"]["Conflict"];
            422: components["responses"]["Unprocessable"];
            503: components["responses"]["ProviderError"];
        };
    };
    une_plan_003: {
        parameters: {
            query?: never;
            header?: {
                "X-Correlation-Id"?: components["parameters"]["CorrelationId"];
            };
            path: {
                planId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Success */
            200: {
                headers: {
                    /** @description 현재 versionNo (PATCH의 If-Match 값) */
                    ETag?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["PlanDetailResponse"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
            409: components["responses"]["Conflict"];
            422: components["responses"]["Unprocessable"];
            503: components["responses"]["ProviderError"];
        };
    };
    une_plan_005: {
        parameters: {
            query?: never;
            header?: {
                "X-Correlation-Id"?: components["parameters"]["CorrelationId"];
            };
            path: {
                planId: string;
            };
            cookie?: never;
        };
        requestBody?: {
            content: {
                "application/json": components["schemas"]["PlanDeleteRequest"];
            };
        };
        responses: {
            /** @description No Content (설계 10 §3.3 응답 204 — 본문 없음) */
            204: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
            409: components["responses"]["Conflict"];
            422: components["responses"]["Unprocessable"];
            503: components["responses"]["ProviderError"];
        };
    };
    une_plan_004: {
        parameters: {
            query?: never;
            header?: {
                "X-Correlation-Id"?: components["parameters"]["CorrelationId"];
                "If-Match"?: components["parameters"]["IfMatch"];
            };
            path: {
                planId: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["PlanMetaPatchRequest"];
            };
        };
        responses: {
            /** @description Success */
            200: {
                headers: {
                    /** @description 갱신된 versionNo */
                    ETag?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["PlanResponse"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
            409: components["responses"]["Conflict"];
            412: components["responses"]["PreconditionFailed"];
            422: components["responses"]["Unprocessable"];
            428: components["responses"]["PreconditionRequired"];
            503: components["responses"]["ProviderError"];
        };
    };
    une_plan_006: {
        parameters: {
            query?: never;
            header?: {
                "X-Correlation-Id"?: components["parameters"]["CorrelationId"];
            };
            path: {
                planId: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["PlanContextDraftRequest"];
            };
        };
        responses: {
            /** @description Success */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ContextDraftResponse"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
            409: components["responses"]["Conflict"];
            412: components["responses"]["PreconditionFailed"];
            422: components["responses"]["Unprocessable"];
            503: components["responses"]["ProviderError"];
        };
    };
    une_plan_008: {
        parameters: {
            query?: never;
            header?: {
                "X-Correlation-Id"?: components["parameters"]["CorrelationId"];
            };
            path: {
                planId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Success */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["PlanContextSnapshotListResponse"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
            409: components["responses"]["Conflict"];
            422: components["responses"]["Unprocessable"];
            503: components["responses"]["ProviderError"];
        };
    };
    une_plan_007: {
        parameters: {
            query?: never;
            header: {
                "X-Correlation-Id"?: components["parameters"]["CorrelationId"];
                "Idempotency-Key": components["parameters"]["IdempotencyKeyRequired"];
            };
            path: {
                planId: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["PlanContext"];
            };
        };
        responses: {
            /** @description Success */
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["PlanContextSnapshotResponse"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
            409: components["responses"]["Conflict"];
            412: components["responses"]["PreconditionFailed"];
            422: components["responses"]["Unprocessable"];
            503: components["responses"]["ProviderError"];
        };
    };
    une_plan_009: {
        parameters: {
            query?: never;
            header: {
                "X-Correlation-Id"?: components["parameters"]["CorrelationId"];
                "Idempotency-Key": components["parameters"]["IdempotencyKeyRequired"];
            };
            path: {
                planId: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["TocGenerationRequest"];
            };
        };
        responses: {
            /** @description Accepted */
            202: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["GenerationJobResponse"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
            409: components["responses"]["Conflict"];
            412: components["responses"]["PreconditionFailed"];
            422: components["responses"]["Unprocessable"];
            503: components["responses"]["ProviderError"];
        };
    };
    une_plan_010: {
        parameters: {
            query?: never;
            header?: {
                "X-Correlation-Id"?: components["parameters"]["CorrelationId"];
            };
            path: {
                jobId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Success */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["GenerationJobResponse"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
            409: components["responses"]["Conflict"];
            422: components["responses"]["Unprocessable"];
            503: components["responses"]["ProviderError"];
        };
    };
    une_plan_011: {
        parameters: {
            query?: never;
            header?: {
                "X-Correlation-Id"?: components["parameters"]["CorrelationId"];
                "Last-Event-ID"?: components["parameters"]["LastEventId"];
            };
            path: {
                jobId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /**
             * @description text/event-stream. 공개 이벤트 어휘: job.queued, job.started, job.progress, toc.section, content.block, job.completed, job.failed, job.cancel_requested, job.cancelled, job.retry_requested.
             *
             *     각 이벤트 프레임은 id(= job_event.sequence_no), event, data를 포함한다. Provider 원문 이벤트는 노출하지 않고 화면용 DTO로 투영한다 (설계 10 §2).
             *
             *     toc.section은 TOC Job(UNE-PLAN-009), content.block은 CONTENT Job(UNE-PLAN-016) 전용이다. content.block payload: {nodeKey, blockId, outcome(GENERATED|PRESERVED|FAILED), sortOrder, outlineLevel, contentHash, citationCount, reason?}. GENERATED는 새 블록의 id/해시를, PRESERVED는 유지된 기존 블록의 id/해시를 싣고, FAILED는 blockId·contentHash가 null이다(행이 만들어지지 않는다). reason은 outcome이 PRESERVED일 때 그 블록의 protection_state 값(USER_LOCKED 또는 SYSTEM_LOCKED)이고, FAILED일 때는 실패 사유 코드다.
             *
             *     content.block은 이번 job의 "대상" 노드에 대해서만 발행한다. 범위 지정 재생성(targetNodeKeys)에서 범위 밖 노드는 손대지 않으므로 프레임을 발행하지 않고 contentSummary에도 집계되지 않는다.
             *
             *     legacy 경로에서는 outcome=FAILED 프레임이 발생하지 않는다: provider 응답이 목차와 정합하지 않으면 job 전체가 FAILED로 끝난다. 블록 단위 실패/재시도는 target-v2 partialRetry(CC-135) 소관이다.
             *
             *     job.progress payload: {completed, total, pct}. CC-130부터 CONTENT Job이 발행을 시작하며, 블록 10개 또는 10%p 진행마다 스로틀한다(마지막 블록은 항상 발행). TOC Job의 job.progress는 기존과 같이 단계 전환 시점에만 발행한다.
             *
             *     heartbeat는 15초 주기로 전송한다. heartbeat 프레임의 id는 마지막으로 전달한 sequence_no를 반복하므로 Last-Event-ID 재개 지점을 이동시키지 않는다.
             *
             *     재접속 시 Last-Event-ID에 마지막으로 수신한 sequence_no를 보내면 그 다음 순번부터 재전송한다.
             *
             *     스트림 최대 수명은 30분이며 서버가 종료한 뒤에는 클라이언트가 Last-Event-ID로 재접속한다 (설계 10 §5 "총시간 정책"이 값을 정하지 않아 CC-120에서 정한 잠정 운영값).
             */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "text/event-stream": string;
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
            409: components["responses"]["Conflict"];
            422: components["responses"]["Unprocessable"];
            503: components["responses"]["ProviderError"];
        };
    };
    une_plan_012: {
        parameters: {
            query?: never;
            header: {
                "X-Correlation-Id"?: components["parameters"]["CorrelationId"];
                "Idempotency-Key": components["parameters"]["IdempotencyKeyRequired"];
            };
            path: {
                jobId: string;
            };
            cookie?: never;
        };
        requestBody?: {
            content: {
                "application/json": components["schemas"]["GenerationJobCancelRequest"];
            };
        };
        responses: {
            /** @description Accepted */
            202: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["GenerationJobResponse"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
            409: components["responses"]["Conflict"];
            422: components["responses"]["Unprocessable"];
            503: components["responses"]["ProviderError"];
        };
    };
    une_plan_013: {
        parameters: {
            query?: never;
            header: {
                "X-Correlation-Id"?: components["parameters"]["CorrelationId"];
                "Idempotency-Key": components["parameters"]["IdempotencyKeyRequired"];
            };
            path: {
                jobId: string;
            };
            cookie?: never;
        };
        requestBody?: {
            content: {
                "application/json": components["schemas"]["GenerationJobRetryRequest"];
            };
        };
        responses: {
            /** @description Accepted */
            202: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["GenerationJobResponse"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
            409: components["responses"]["Conflict"];
            422: components["responses"]["Unprocessable"];
            503: components["responses"]["ProviderError"];
        };
    };
    une_plan_014: {
        parameters: {
            query?: never;
            header: {
                "X-Correlation-Id"?: components["parameters"]["CorrelationId"];
                "Idempotency-Key": components["parameters"]["IdempotencyKeyRequired"];
            };
            path: {
                planId: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["TocVersionSaveRequest"];
            };
        };
        responses: {
            /** @description Created */
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["TocVersionResponse"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
            409: components["responses"]["Conflict"];
            412: components["responses"]["PreconditionFailed"];
            422: components["responses"]["Unprocessable"];
            503: components["responses"]["ProviderError"];
        };
    };
    une_plan_015: {
        parameters: {
            query?: never;
            header?: {
                "X-Correlation-Id"?: components["parameters"]["CorrelationId"];
            };
            path: {
                planId: string;
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Success */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["TocVersionResponse"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
            409: components["responses"]["Conflict"];
            422: components["responses"]["Unprocessable"];
            503: components["responses"]["ProviderError"];
        };
    };
    une_plan_016: {
        parameters: {
            query?: never;
            header: {
                "X-Correlation-Id"?: components["parameters"]["CorrelationId"];
                "Idempotency-Key": components["parameters"]["IdempotencyKeyRequired"];
            };
            path: {
                planId: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["ContentGenerationRequest"];
            };
        };
        responses: {
            /** @description Accepted */
            202: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["GenerationJobResponse"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
            409: components["responses"]["Conflict"];
            412: components["responses"]["PreconditionFailed"];
            422: components["responses"]["Unprocessable"];
            428: components["responses"]["PreconditionRequired"];
            503: components["responses"]["ProviderError"];
        };
    };
    une_doc_001: {
        parameters: {
            query?: never;
            header?: {
                "X-Correlation-Id"?: components["parameters"]["CorrelationId"];
                "Idempotency-Key"?: components["parameters"]["IdempotencyKey"];
            };
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["FileRegisterRequest"];
            };
        };
        responses: {
            /** @description Success */
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["FileRegistrationResponse"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
            409: components["responses"]["Conflict"];
            422: components["responses"]["Unprocessable"];
            503: components["responses"]["ProviderError"];
        };
    };
    une_doc_002: {
        parameters: {
            query?: never;
            header?: {
                "X-Correlation-Id"?: components["parameters"]["CorrelationId"];
                "Idempotency-Key"?: components["parameters"]["IdempotencyKey"];
            };
            path: {
                fileId: string;
            };
            cookie?: never;
        };
        requestBody?: {
            content: {
                "application/json": components["schemas"]["FileCompleteRequest"];
            };
        };
        responses: {
            /** @description Success */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["FileObjectResponse"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
            409: components["responses"]["Conflict"];
            422: components["responses"]["Unprocessable"];
            503: components["responses"]["ProviderError"];
        };
    };
    une_doc_001_transport: {
        parameters: {
            query: {
                /**
                 * @description UNE-DOC-001이 발급한 업로드 티켓. **확정 전에는 재전송할 수 있다**
                 *     (전송 실패의 재시도 경로다). 확정(VERIFIED/ABORTED) 후에는 409다.
                 */
                token: string;
            };
            header?: {
                "X-Correlation-Id"?: components["parameters"]["CorrelationId"];
            };
            path: {
                fileId: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/octet-stream": string;
            };
        };
        responses: {
            /** @description 저장 완료 (본문 없음) */
            204: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            400: components["responses"]["BadRequest"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
            409: components["responses"]["Conflict"];
            /** @description 선언 크기를 넘는 본문 */
            413: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
            503: components["responses"]["ProviderError"];
        };
    };
    une_doc_003: {
        parameters: {
            query?: never;
            header?: {
                "X-Correlation-Id"?: components["parameters"]["CorrelationId"];
                "Idempotency-Key"?: components["parameters"]["IdempotencyKey"];
            };
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["HwpImportRequest"];
            };
        };
        responses: {
            /** @description Success */
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HwpImportResponse"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
            409: components["responses"]["Conflict"];
            422: components["responses"]["Unprocessable"];
            503: components["responses"]["ProviderError"];
        };
    };
    une_doc_004: {
        parameters: {
            query?: never;
            header?: {
                "X-Correlation-Id"?: components["parameters"]["CorrelationId"];
            };
            path: {
                documentId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Success */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["DocumentAnalysisResponse"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
            409: components["responses"]["Conflict"];
            422: components["responses"]["Unprocessable"];
            503: components["responses"]["ProviderError"];
        };
    };
    une_doc_005: {
        parameters: {
            query?: {
                /** @description 생략 시 head Revision. */
                revisionId?: string;
            };
            header?: {
                "X-Correlation-Id"?: components["parameters"]["CorrelationId"];
            };
            path: {
                documentId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Success */
            200: {
                headers: {
                    /** @description 반환한 Revision의 revision_no (강한 태그, 예 `"3"`) */
                    ETag?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["DocumentIrResponse"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
            409: components["responses"]["Conflict"];
            422: components["responses"]["Unprocessable"];
            503: components["responses"]["ProviderError"];
        };
    };
    une_doc_006: {
        parameters: {
            query?: never;
            header: {
                "X-Correlation-Id"?: components["parameters"]["CorrelationId"];
                "If-Match": components["parameters"]["IfMatchRequired"];
            };
            path: {
                documentId: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["ChangeSetRequest"];
            };
        };
        responses: {
            /** @description Success */
            200: {
                headers: {
                    /** @description 새 head revision_no (dryRun이면 기존 값) */
                    ETag?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ChangeSetResultResponse"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
            409: components["responses"]["RevisionConflict"];
            422: components["responses"]["Unprocessable"];
            428: components["responses"]["PreconditionRequired"];
            503: components["responses"]["ProviderError"];
        };
    };
    une_doc_007: {
        parameters: {
            query?: {
                page?: number;
                size?: number;
            };
            header?: {
                "X-Correlation-Id"?: components["parameters"]["CorrelationId"];
            };
            path: {
                documentId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Success */
            200: {
                headers: {
                    /** @description 현재 head revision_no */
                    ETag?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["RevisionPageResponse"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
            409: components["responses"]["Conflict"];
            422: components["responses"]["Unprocessable"];
            503: components["responses"]["ProviderError"];
        };
    };
    une_doc_008: {
        parameters: {
            query?: never;
            header: {
                "X-Correlation-Id"?: components["parameters"]["CorrelationId"];
                "If-Match": components["parameters"]["IfMatchRequired"];
            };
            path: {
                documentId: string;
                /** @description 복원 대상(과거) Revision */
                revisionId: string;
            };
            cookie?: never;
        };
        requestBody?: {
            content: {
                "application/json": components["schemas"]["RevisionRestoreRequest"];
            };
        };
        responses: {
            /** @description Success */
            200: {
                headers: {
                    /** @description 복원으로 생성된 새 head revision_no */
                    ETag?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["RevisionRestoreResponse"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
            409: components["responses"]["RevisionConflict"];
            422: components["responses"]["Unprocessable"];
            428: components["responses"]["PreconditionRequired"];
            503: components["responses"]["ProviderError"];
        };
    };
    une_doc_009: {
        parameters: {
            query?: never;
            header: {
                "X-Correlation-Id"?: components["parameters"]["CorrelationId"];
                "If-Match": components["parameters"]["IfMatchRequired"];
            };
            path: {
                documentId: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["AutosaveRequest"];
            };
        };
        responses: {
            /** @description Success */
            200: {
                headers: {
                    /** @description 새 head revision_no (SUPERSEDED면 기존 값) */
                    ETag?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["AutosaveReceiptResponse"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
            409: components["responses"]["RevisionConflict"];
            422: components["responses"]["Unprocessable"];
            428: components["responses"]["PreconditionRequired"];
            503: components["responses"]["ProviderError"];
        };
    };
    une_doc_010: {
        parameters: {
            query?: never;
            header?: {
                "X-Correlation-Id"?: components["parameters"]["CorrelationId"];
                "Idempotency-Key"?: components["parameters"]["IdempotencyKey"];
            };
            path: {
                documentId: string;
            };
            cookie?: never;
        };
        requestBody?: {
            content: {
                "application/json": components["schemas"]["GenericRequest"];
            };
        };
        responses: {
            /** @description Success */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["GenerationJob"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
            409: components["responses"]["Conflict"];
            422: components["responses"]["Unprocessable"];
            503: components["responses"]["ProviderError"];
        };
    };
    une_doc_011: {
        parameters: {
            query?: never;
            header?: {
                "X-Correlation-Id"?: components["parameters"]["CorrelationId"];
            };
            path: {
                documentId: string;
                jobId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Success */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["GenericResponse"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
            409: components["responses"]["Conflict"];
            422: components["responses"]["Unprocessable"];
            503: components["responses"]["ProviderError"];
        };
    };
    une_doc_012: {
        parameters: {
            query?: never;
            header?: {
                "X-Correlation-Id"?: components["parameters"]["CorrelationId"];
                "Idempotency-Key"?: components["parameters"]["IdempotencyKey"];
            };
            path: {
                documentId: string;
            };
            cookie?: never;
        };
        requestBody?: {
            content: {
                "application/json": components["schemas"]["ExportRequest"];
            };
        };
        responses: {
            /** @description Success */
            202: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ExportJobResponse"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
            409: components["responses"]["Conflict"];
            422: components["responses"]["Unprocessable"];
            503: components["responses"]["ProviderError"];
        };
    };
    une_doc_013: {
        parameters: {
            query?: never;
            header?: {
                "X-Correlation-Id"?: components["parameters"]["CorrelationId"];
            };
            path: {
                exportId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Success */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ExportJobResponse"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
            409: components["responses"]["Conflict"];
            422: components["responses"]["Unprocessable"];
            503: components["responses"]["ProviderError"];
        };
    };
    une_doc_014: {
        parameters: {
            query?: never;
            header?: {
                "X-Correlation-Id"?: components["parameters"]["CorrelationId"];
            };
            path: {
                exportId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Binary file */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/hwp+zip": string;
                    "application/octet-stream": string;
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
            409: components["responses"]["Conflict"];
            410: components["responses"]["Gone"];
            422: components["responses"]["Unprocessable"];
            503: components["responses"]["ProviderError"];
        };
    };
    une_doc_015: {
        parameters: {
            query?: never;
            header?: {
                "X-Correlation-Id"?: components["parameters"]["CorrelationId"];
                "Idempotency-Key"?: components["parameters"]["IdempotencyKey"];
            };
            path: {
                documentId: string;
            };
            cookie?: never;
        };
        requestBody?: {
            content: {
                "application/json": components["schemas"]["GenericRequest"];
            };
        };
        responses: {
            /** @description Success */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["GenericResponse"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
            409: components["responses"]["Conflict"];
            422: components["responses"]["Unprocessable"];
            503: components["responses"]["ProviderError"];
        };
    };
    une_doc_016: {
        parameters: {
            query?: never;
            header?: {
                "X-Correlation-Id"?: components["parameters"]["CorrelationId"];
                "Idempotency-Key"?: components["parameters"]["IdempotencyKey"];
            };
            path: {
                documentId: string;
            };
            cookie?: never;
        };
        requestBody?: {
            content: {
                "application/json": components["schemas"]["GenericRequest"];
            };
        };
        responses: {
            /** @description Success */
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["GenericResponse"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
            409: components["responses"]["Conflict"];
            422: components["responses"]["Unprocessable"];
            503: components["responses"]["ProviderError"];
        };
    };
    une_doc_017: {
        parameters: {
            query?: never;
            header?: {
                "X-Correlation-Id"?: components["parameters"]["CorrelationId"];
                "Idempotency-Key"?: components["parameters"]["IdempotencyKey"];
            };
            path: {
                documentId: string;
            };
            cookie?: never;
        };
        requestBody?: {
            content: {
                "application/json": components["schemas"]["GenericRequest"];
            };
        };
        responses: {
            /** @description Success */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["GenericResponse"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
            409: components["responses"]["Conflict"];
            422: components["responses"]["Unprocessable"];
            503: components["responses"]["ProviderError"];
        };
    };
    une_sit_002: {
        parameters: {
            query?: {
                mode?: components["schemas"]["SituationMode"];
                status?: components["schemas"]["SituationStatus"];
                hazardType?: string;
                keyword?: string;
                page?: number;
                size?: number;
            };
            header?: {
                "X-Correlation-Id"?: components["parameters"]["CorrelationId"];
            };
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Success */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["SituationPageResponse"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
            409: components["responses"]["Conflict"];
            422: components["responses"]["Unprocessable"];
            503: components["responses"]["ProviderError"];
        };
    };
    une_sit_001: {
        parameters: {
            query?: never;
            header?: {
                "X-Correlation-Id"?: components["parameters"]["CorrelationId"];
                "Idempotency-Key"?: components["parameters"]["IdempotencyKey"];
            };
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                /**
                 * @example {
                 *       "mode": "LIVE",
                 *       "title": "○○시 집중호우 대응",
                 *       "hazardType": "태풍/호우",
                 *       "occurredAt": "2026-08-08T09:00:00+09:00",
                 *       "locationText": "○○시 ○○동"
                 *     }
                 */
                "application/json": components["schemas"]["SituationCreateRequest"];
            };
        };
        responses: {
            /** @description Success */
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    /**
                     * @example {
                     *       "success": true,
                     *       "data": {
                     *         "situationId": "3f2a9c10-5b6d-4e7f-8a90-1b2c3d4e5f60",
                     *         "tenantId": "11111111-2222-4333-8444-555555555555",
                     *         "mode": "LIVE",
                     *         "title": "○○시 집중호우 대응",
                     *         "hazardType": "태풍/호우",
                     *         "status": "DRAFT",
                     *         "occurredAt": "2026-08-08T00:00:00.000Z",
                     *         "locationText": "○○시 ○○동",
                     *         "currentSnapshotId": null,
                     *         "versionNo": 1,
                     *         "createdBy": "66666666-7777-4888-8999-aaaaaaaaaaaa",
                     *         "createdAt": "2026-08-08T00:05:00.000Z",
                     *         "updatedAt": "2026-08-08T00:05:00.000Z"
                     *       },
                     *       "meta": {
                     *         "requestId": "req_7c1d9e2f0a3b",
                     *         "correlationId": "corr_9f1e0a2b3c4d",
                     *         "timestamp": "2026-08-08T00:05:00.000Z",
                     *         "schemaVersion": "1.0"
                     *       }
                     *     }
                     */
                    "application/json": components["schemas"]["SituationResponse"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
            409: components["responses"]["Conflict"];
            422: components["responses"]["Unprocessable"];
            503: components["responses"]["ProviderError"];
        };
    };
    une_sit_003: {
        parameters: {
            query?: never;
            header?: {
                "X-Correlation-Id"?: components["parameters"]["CorrelationId"];
            };
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Success */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["SituationDetailResponse"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
            409: components["responses"]["Conflict"];
            422: components["responses"]["Unprocessable"];
            503: components["responses"]["ProviderError"];
        };
    };
    une_sit_004: {
        parameters: {
            query?: never;
            header?: {
                "X-Correlation-Id"?: components["parameters"]["CorrelationId"];
                "Idempotency-Key"?: components["parameters"]["IdempotencyKey"];
                "If-Match"?: components["parameters"]["IfMatch"];
            };
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                /**
                 * @example {
                 *       "title": "○○시 집중호우 대응",
                 *       "locationText": "○○시 ○○동"
                 *     }
                 */
                "application/json": components["schemas"]["SituationPatchRequest"];
            };
        };
        responses: {
            /** @description Success */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["SituationResponse"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
            409: components["responses"]["Conflict"];
            412: components["responses"]["PreconditionFailed"];
            422: components["responses"]["Unprocessable"];
            428: components["responses"]["PreconditionRequired"];
            503: components["responses"]["ProviderError"];
        };
    };
    une_sit_005: {
        parameters: {
            query?: never;
            header?: {
                "X-Correlation-Id"?: components["parameters"]["CorrelationId"];
                "Idempotency-Key"?: components["parameters"]["IdempotencyKey"];
            };
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                /**
                 * @example {
                 *       "providers": [
                 *         "KMA",
                 *         "MOIS"
                 *       ],
                 *       "query": {
                 *         "adminCode": "1100000000"
                 *       },
                 *       "categories": [
                 *         "WEATHER_OBSERVATION",
                 *         "DISASTER_MESSAGE"
                 *       ],
                 *       "featureFlags": {
                 *         "safekorea": false,
                 *         "naver": false,
                 *         "t3q": false
                 *       }
                 *     }
                 */
                "application/json": components["schemas"]["ProviderQueryRequest"];
            };
        };
        responses: {
            /** @description 수집 결과. **동기 수집이므로 반환 시점에 모든 Job이 종결돼 있다** (ADR-33 D2). Provider 일부가 실패해도 200이며 개별 결과는 `jobs[].status`에 있다 — 부분장애가 전체 흐름을 막지 않는다는 설계 06 US-SIT-005의 요구다. 503은 요청 자체를 처리하지 못한 경우에만 쓴다. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    /**
                     * @example {
                     *       "success": true,
                     *       "data": {
                     *         "batchId": "9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d",
                     *         "situationId": "3f2a9c10-5b6d-4e7f-8a90-1b2c3d4e5f60",
                     *         "jobs": [
                     *           {
                     *             "providerJobId": "1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d",
                     *             "batchId": "9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d",
                     *             "situationId": "3f2a9c10-5b6d-4e7f-8a90-1b2c3d4e5f60",
                     *             "providerCode": "KMA",
                     *             "status": "FAILED",
                     *             "resultCount": 0,
                     *             "error": {
                     *               "kind": "TIMEOUT",
                     *               "message": "10000ms 안에 응답하지 않았습니다.",
                     *               "retriable": true,
                     *               "rejectedCount": 0
                     *             },
                     *             "correlationId": "corr_9f1e0a2b3c4d",
                     *             "createdAt": "2026-08-08T00:10:00.000Z",
                     *             "finishedAt": "2026-08-08T00:10:10.000Z"
                     *           },
                     *           {
                     *             "providerJobId": "2b3c4d5e-6f7a-4b8c-9d0e-1f2a3b4c5d6e",
                     *             "batchId": "9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d",
                     *             "situationId": "3f2a9c10-5b6d-4e7f-8a90-1b2c3d4e5f60",
                     *             "providerCode": "MOIS",
                     *             "status": "PARTIAL",
                     *             "resultCount": 3,
                     *             "error": {
                     *               "kind": "NORMALIZATION_REJECTED",
                     *               "message": "일부 항목이 정규화에서 탈락했습니다.",
                     *               "retriable": false,
                     *               "rejectedCount": 1,
                     *               "reasons": [
                     *                 "FACT_KEY_MALFORMED"
                     *               ]
                     *             },
                     *             "correlationId": "corr_9f1e0a2b3c4d",
                     *             "createdAt": "2026-08-08T00:10:00.000Z",
                     *             "finishedAt": "2026-08-08T00:10:01.000Z"
                     *           }
                     *         ],
                     *         "factsCreated": 3
                     *       },
                     *       "meta": {
                     *         "requestId": "req_7c1d9e2f0a3b",
                     *         "correlationId": "corr_9f1e0a2b3c4d",
                     *         "timestamp": "2026-08-08T00:10:10.000Z",
                     *         "schemaVersion": "1.0"
                     *       }
                     *     }
                     */
                    "application/json": components["schemas"]["ProviderQueryJobResponse"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
            409: components["responses"]["Conflict"];
            422: components["responses"]["Unprocessable"];
            503: components["responses"]["ProviderError"];
        };
    };
    une_sit_015: {
        parameters: {
            query?: never;
            header?: {
                "X-Correlation-Id"?: components["parameters"]["CorrelationId"];
            };
            path: {
                jobId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Success */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ProviderJobResponse"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
        };
    };
    une_sit_006: {
        parameters: {
            query?: never;
            header?: {
                "X-Correlation-Id"?: components["parameters"]["CorrelationId"];
            };
            path: {
                jobId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description SSE stream */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "text/event-stream": string;
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
            409: components["responses"]["Conflict"];
            422: components["responses"]["Unprocessable"];
            503: components["responses"]["ProviderError"];
        };
    };
    une_sit_014: {
        parameters: {
            query?: {
                status?: components["schemas"]["SituationFactStatus"];
                factType?: components["schemas"]["SituationFactType"];
                page?: number;
                size?: number;
            };
            header?: {
                "X-Correlation-Id"?: components["parameters"]["CorrelationId"];
            };
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Success */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["SituationFactPageResponse"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
        };
    };
    une_sit_007: {
        parameters: {
            query?: never;
            header?: {
                "X-Correlation-Id"?: components["parameters"]["CorrelationId"];
                "Idempotency-Key"?: components["parameters"]["IdempotencyKey"];
            };
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                /**
                 * @example {
                 *       "factType": "FIELD_REPORT",
                 *       "factKey": "damage",
                 *       "value": {
                 *         "floodedHouseholds": 12
                 *       },
                 *       "observedAt": "2026-08-08T09:00:00+09:00",
                 *       "source": {
                 *         "sourceName": "○○시 재난안전대책본부 현장보고"
                 *       }
                 *     }
                 */
                "application/json": components["schemas"]["SituationFactCreateRequest"];
            };
        };
        responses: {
            /** @description Success */
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    /**
                     * @example {
                     *       "success": true,
                     *       "data": {
                     *         "factId": "4c5d6e7f-8a9b-4c0d-8e1f-2a3b4c5d6e7f",
                     *         "situationId": "3f2a9c10-5b6d-4e7f-8a90-1b2c3d4e5f60",
                     *         "factType": "WEATHER_OBSERVATION",
                     *         "factKey": "wind_speed",
                     *         "value": 10,
                     *         "unit": "m/s",
                     *         "source": {
                     *           "sourceId": "5d6e7f8a-9b0c-4d1e-8f2a-3b4c5d6e7f8a",
                     *           "providerCode": "MANUAL",
                     *           "sourceType": "USER",
                     *           "sourceName": "사용자 직접 입력",
                     *           "sourceUrl": null,
                     *           "collectedAt": "2026-08-08T00:20:00.000Z"
                     *         },
                     *         "observedAt": "2026-08-08T00:00:00.000Z",
                     *         "collectedAt": "2026-08-08T00:20:00.000Z",
                     *         "confidence": null,
                     *         "status": "CANDIDATE",
                     *         "normalization": {
                     *           "version": "1.0.0",
                     *           "outcome": "NORMALIZED",
                     *           "originalValue": 36,
                     *           "originalUnit": "km/h",
                     *           "notes": []
                     *         },
                     *         "originalFactId": null,
                     *         "derivedReason": null,
                     *         "versionNo": 1,
                     *         "updatedAt": "2026-08-08T00:20:00.000Z"
                     *       },
                     *       "meta": {
                     *         "requestId": "req_7c1d9e2f0a3b",
                     *         "correlationId": "corr_9f1e0a2b3c4d",
                     *         "timestamp": "2026-08-08T00:20:00.000Z",
                     *         "schemaVersion": "1.0"
                     *       }
                     *     }
                     */
                    "application/json": components["schemas"]["SituationFactResponse"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
            409: components["responses"]["Conflict"];
            422: components["responses"]["Unprocessable"];
            503: components["responses"]["ProviderError"];
        };
    };
    une_sit_008: {
        parameters: {
            query?: never;
            header?: {
                "X-Correlation-Id"?: components["parameters"]["CorrelationId"];
                "Idempotency-Key"?: components["parameters"]["IdempotencyKey"];
                "If-Match"?: components["parameters"]["IfMatch"];
            };
            path: {
                id: string;
                factId: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                /**
                 * @example {
                 *       "value": 12.5,
                 *       "unit": "mm",
                 *       "reason": "현장 재확인값으로 보정"
                 *     }
                 */
                "application/json": components["schemas"]["SituationFactPatchRequest"];
            };
        };
        responses: {
            /** @description Success */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["SituationFactResponse"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
            409: components["responses"]["Conflict"];
            412: components["responses"]["PreconditionFailed"];
            422: components["responses"]["Unprocessable"];
            428: components["responses"]["PreconditionRequired"];
            503: components["responses"]["ProviderError"];
        };
    };
    une_sit_009: {
        parameters: {
            query?: never;
            header?: {
                "X-Correlation-Id"?: components["parameters"]["CorrelationId"];
                "Idempotency-Key"?: components["parameters"]["IdempotencyKey"];
            };
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody?: {
            content: {
                "application/json": components["schemas"]["DeduplicateRequest"];
            };
        };
        responses: {
            /** @description Success */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["DeduplicateResponse"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
            409: components["responses"]["Conflict"];
            412: components["responses"]["PreconditionFailed"];
            422: components["responses"]["Unprocessable"];
            503: components["responses"]["ProviderError"];
        };
    };
    une_sit_010: {
        parameters: {
            query?: {
                /** @description 생략하면 전부. 설계 10 SIT 표가 요청 요약에 status를 적었다. */
                status?: "OPEN" | "RESOLVED" | "OBSOLETE";
            };
            header?: {
                "X-Correlation-Id"?: components["parameters"]["CorrelationId"];
            };
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Success */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["FactConflictListResponse"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
            409: components["responses"]["Conflict"];
            422: components["responses"]["Unprocessable"];
            503: components["responses"]["ProviderError"];
        };
    };
    une_sit_011: {
        parameters: {
            query?: never;
            header?: {
                "X-Correlation-Id"?: components["parameters"]["CorrelationId"];
                "Idempotency-Key"?: components["parameters"]["IdempotencyKey"];
            };
            path: {
                id: string;
                conflictId: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["ConflictResolveRequest"];
            };
        };
        responses: {
            /** @description Success */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ConflictResolutionResponse"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
            409: components["responses"]["Conflict"];
            412: components["responses"]["PreconditionFailed"];
            422: components["responses"]["Unprocessable"];
            503: components["responses"]["ProviderError"];
        };
    };
    une_sit_013: {
        parameters: {
            query?: {
                /** @description 비교 기준 Snapshot. 주면 최신판과의 Diff를 함께 준다(인수기준 "change comparison"). 생략하면 목록만 준다. */
                compareTo?: string;
            };
            header?: {
                "X-Correlation-Id"?: components["parameters"]["CorrelationId"];
            };
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Success */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["SituationSnapshotListResponse"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
            409: components["responses"]["Conflict"];
            422: components["responses"]["Unprocessable"];
            503: components["responses"]["ProviderError"];
        };
    };
    une_sit_012: {
        parameters: {
            query?: never;
            header?: {
                "X-Correlation-Id"?: components["parameters"]["CorrelationId"];
                "Idempotency-Key"?: components["parameters"]["IdempotencyKey"];
            };
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["SituationSnapshotCreateRequest"];
            };
        };
        responses: {
            /** @description 확정된 Snapshot. **자원 생성이므로 201이다** — 재확정도 새 snapshotId를 만든다(설계 06 US-SIT-008 인수기준). 멱등 재생도 같은 코드로 나간다. */
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["SituationSnapshotResponse"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
            409: components["responses"]["Conflict"];
            412: components["responses"]["PreconditionFailed"];
            422: components["responses"]["Unprocessable"];
            503: components["responses"]["ProviderError"];
        };
    };
    une_know_001: {
        parameters: {
            query?: never;
            header?: {
                "X-Correlation-Id"?: components["parameters"]["CorrelationId"];
                "Idempotency-Key"?: components["parameters"]["IdempotencyKey"];
            };
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["KnowledgeDocumentCreateRequest"];
            };
        };
        responses: {
            /** @description 등록 접수. UNI 호출은 워커가 수행하므로(설계 10 §7.23 7단계) 이 응답 시점에 UNI 처리는 시작되지 않았다. 진행은 UNE-KNOW-002로 조회한다. */
            202: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["KnowledgeDocumentResponse"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
            409: components["responses"]["Conflict"];
            422: components["responses"]["Unprocessable"];
            503: components["responses"]["ProviderError"];
        };
    };
    une_know_002: {
        parameters: {
            query?: never;
            header?: {
                "X-Correlation-Id"?: components["parameters"]["CorrelationId"];
            };
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description 마지막으로 **관측한** 상태. 이 API는 UNI를 호출하지 않는다 — 폴링은 워커가 하고(설계 08 §1.14의 2/4/8/15초) 여기서는 그 결과를 읽는다. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["KnowledgeDocumentResponse"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
            409: components["responses"]["Conflict"];
            422: components["responses"]["Unprocessable"];
            503: components["responses"]["ProviderError"];
        };
    };
    une_know_003: {
        parameters: {
            query?: never;
            header?: {
                "X-Correlation-Id"?: components["parameters"]["CorrelationId"];
                "Idempotency-Key"?: components["parameters"]["IdempotencyKey"];
            };
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["KnowledgeDocumentRetryRequest"];
            };
        };
        responses: {
            /** @description 재시도 접수. 새 provider_job이 QUEUED로 생기고 워커가 다시 보낸다. */
            202: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["KnowledgeDocumentResponse"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
            409: components["responses"]["Conflict"];
            422: components["responses"]["Unprocessable"];
            503: components["responses"]["ProviderError"];
        };
    };
    une_know_004: {
        parameters: {
            query?: never;
            header?: {
                "X-Correlation-Id"?: components["parameters"]["CorrelationId"];
                "Idempotency-Key"?: components["parameters"]["IdempotencyKey"];
            };
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["EvidenceSearchRequest"];
            };
        };
        responses: {
            /** @description 검색 결과로 만든 DRAFT EvidenceSet. **동기 호출이다**(설계 08 §1.14 30초·1회) — 사용자가 결과를 보고 고르는 흐름이므로 202가 아니다. 결과 0건도 정상이다(US-SIT-011 A-01). */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["EvidenceSetResponse"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
            409: components["responses"]["Conflict"];
            422: components["responses"]["Unprocessable"];
            503: components["responses"]["ProviderError"];
        };
    };
    une_know_005: {
        parameters: {
            query?: never;
            header?: {
                "X-Correlation-Id"?: components["parameters"]["CorrelationId"];
            };
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description EvidenceSet과 그 근거들. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["EvidenceSetResponse"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
            409: components["responses"]["Conflict"];
            422: components["responses"]["Unprocessable"];
            503: components["responses"]["ProviderError"];
        };
    };
    une_know_006: {
        parameters: {
            query?: never;
            header?: {
                "X-Correlation-Id"?: components["parameters"]["CorrelationId"];
                "Idempotency-Key"?: components["parameters"]["IdempotencyKey"];
            };
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["EvidenceLockRequest"];
            };
        };
        responses: {
            /** @description 동결된 EvidenceSet. 이후 집합도 항목도 바뀌지 않는다. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["EvidenceSetResponse"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
            409: components["responses"]["Conflict"];
            422: components["responses"]["Unprocessable"];
            503: components["responses"]["ProviderError"];
        };
    };
    une_know_007: {
        parameters: {
            query?: never;
            header?: {
                "X-Correlation-Id"?: components["parameters"]["CorrelationId"];
            };
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description 근거 하나의 원문 위치. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["SourceLocatorResponse"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
            409: components["responses"]["Conflict"];
            422: components["responses"]["Unprocessable"];
            503: components["responses"]["ProviderError"];
        };
    };
    une_sop_001: {
        parameters: {
            query?: never;
            header?: {
                "X-Correlation-Id"?: components["parameters"]["CorrelationId"];
                "Idempotency-Key"?: components["parameters"]["IdempotencyKey"];
            };
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody?: {
            content: {
                "application/json": components["schemas"]["SopGenerationRequest"];
            };
        };
        responses: {
            /** @description Success */
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["GenerationJob"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
            409: components["responses"]["Conflict"];
            422: components["responses"]["Unprocessable"];
            503: components["responses"]["ProviderError"];
        };
    };
    une_sop_002: {
        parameters: {
            query?: never;
            header?: {
                "X-Correlation-Id"?: components["parameters"]["CorrelationId"];
            };
            path: {
                jobId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description SSE stream */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "text/event-stream": string;
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
            409: components["responses"]["Conflict"];
            422: components["responses"]["Unprocessable"];
            503: components["responses"]["ProviderError"];
        };
    };
    une_sop_004: {
        parameters: {
            query?: never;
            header?: {
                "X-Correlation-Id"?: components["parameters"]["CorrelationId"];
            };
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Success */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["SopRun"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
            409: components["responses"]["Conflict"];
            422: components["responses"]["Unprocessable"];
            503: components["responses"]["ProviderError"];
        };
    };
    une_sop_003: {
        parameters: {
            query?: never;
            header?: {
                "X-Correlation-Id"?: components["parameters"]["CorrelationId"];
                "Idempotency-Key"?: components["parameters"]["IdempotencyKey"];
            };
            path?: never;
            cookie?: never;
        };
        requestBody?: {
            content: {
                "application/json": components["schemas"]["SopCreateRequest"];
            };
        };
        responses: {
            /** @description Success */
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["SopRun"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
            409: components["responses"]["Conflict"];
            422: components["responses"]["Unprocessable"];
            503: components["responses"]["ProviderError"];
        };
    };
    une_sop_005: {
        parameters: {
            query?: never;
            header?: {
                "X-Correlation-Id"?: components["parameters"]["CorrelationId"];
            };
            path: {
                sopId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Success */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["SopRun"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
            409: components["responses"]["Conflict"];
            422: components["responses"]["Unprocessable"];
            503: components["responses"]["ProviderError"];
        };
    };
    une_sop_006: {
        parameters: {
            query?: never;
            header?: {
                "X-Correlation-Id"?: components["parameters"]["CorrelationId"];
                "Idempotency-Key"?: components["parameters"]["IdempotencyKey"];
            };
            path: {
                sopId: string;
            };
            cookie?: never;
        };
        requestBody?: {
            content: {
                "application/json": components["schemas"]["SopGraph"];
            };
        };
        responses: {
            /** @description Success */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["SopRun"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
            409: components["responses"]["Conflict"];
            422: components["responses"]["Unprocessable"];
            503: components["responses"]["ProviderError"];
        };
    };
    une_sop_007: {
        parameters: {
            query?: never;
            header?: {
                "X-Correlation-Id"?: components["parameters"]["CorrelationId"];
                "Idempotency-Key"?: components["parameters"]["IdempotencyKey"];
            };
            path: {
                sopId: string;
            };
            cookie?: never;
        };
        requestBody?: {
            content: {
                "application/json": components["schemas"]["GenericRequest"];
            };
        };
        responses: {
            /** @description Success */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["SopRun"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
            409: components["responses"]["Conflict"];
            422: components["responses"]["Unprocessable"];
            503: components["responses"]["ProviderError"];
        };
    };
    une_sop_008: {
        parameters: {
            query?: never;
            header?: {
                "X-Correlation-Id"?: components["parameters"]["CorrelationId"];
                "Idempotency-Key"?: components["parameters"]["IdempotencyKey"];
            };
            path: {
                sopId: string;
            };
            cookie?: never;
        };
        requestBody?: {
            content: {
                "application/json": components["schemas"]["GenericRequest"];
            };
        };
        responses: {
            /** @description Success */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["SopRun"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
            409: components["responses"]["Conflict"];
            422: components["responses"]["Unprocessable"];
            503: components["responses"]["ProviderError"];
        };
    };
    une_sop_009: {
        parameters: {
            query?: never;
            header?: {
                "X-Correlation-Id"?: components["parameters"]["CorrelationId"];
                "Idempotency-Key"?: components["parameters"]["IdempotencyKey"];
            };
            path: {
                sopId: string;
            };
            cookie?: never;
        };
        requestBody?: {
            content: {
                "application/json": components["schemas"]["GenericRequest"];
            };
        };
        responses: {
            /** @description Success */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["SopRun"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
            409: components["responses"]["Conflict"];
            422: components["responses"]["Unprocessable"];
            503: components["responses"]["ProviderError"];
        };
    };
    une_sop_010: {
        parameters: {
            query?: never;
            header?: {
                "X-Correlation-Id"?: components["parameters"]["CorrelationId"];
                "Idempotency-Key"?: components["parameters"]["IdempotencyKey"];
            };
            path: {
                sopId: string;
            };
            cookie?: never;
        };
        requestBody?: {
            content: {
                "application/json": components["schemas"]["GenericRequest"];
            };
        };
        responses: {
            /** @description Success */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["SopRun"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
            409: components["responses"]["Conflict"];
            422: components["responses"]["Unprocessable"];
            503: components["responses"]["ProviderError"];
        };
    };
    une_sop_011: {
        parameters: {
            query?: never;
            header?: {
                "X-Correlation-Id"?: components["parameters"]["CorrelationId"];
                "Idempotency-Key"?: components["parameters"]["IdempotencyKey"];
            };
            path: {
                sopId: string;
            };
            cookie?: never;
        };
        requestBody?: {
            content: {
                "application/json": components["schemas"]["SopRunCreateRequest"];
            };
        };
        responses: {
            /** @description Success */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["SopRun"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
            409: components["responses"]["Conflict"];
            422: components["responses"]["Unprocessable"];
            503: components["responses"]["ProviderError"];
        };
    };
    une_sop_012: {
        parameters: {
            query?: never;
            header?: {
                "X-Correlation-Id"?: components["parameters"]["CorrelationId"];
            };
            path: {
                runId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Success */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["SopRun"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
            409: components["responses"]["Conflict"];
            422: components["responses"]["Unprocessable"];
            503: components["responses"]["ProviderError"];
        };
    };
    une_sop_013: {
        parameters: {
            query?: never;
            header?: {
                "X-Correlation-Id"?: components["parameters"]["CorrelationId"];
            };
            path: {
                runId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description SSE stream */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "text/event-stream": string;
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
            409: components["responses"]["Conflict"];
            422: components["responses"]["Unprocessable"];
            503: components["responses"]["ProviderError"];
        };
    };
    une_sop_014: {
        parameters: {
            query?: never;
            header?: {
                "X-Correlation-Id"?: components["parameters"]["CorrelationId"];
                "Idempotency-Key"?: components["parameters"]["IdempotencyKey"];
            };
            path: {
                runId: string;
            };
            cookie?: never;
        };
        requestBody?: {
            content: {
                "application/json": components["schemas"]["GenericRequest"];
            };
        };
        responses: {
            /** @description Success */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["SopRun"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
            409: components["responses"]["Conflict"];
            422: components["responses"]["Unprocessable"];
            503: components["responses"]["ProviderError"];
        };
    };
    une_sop_015: {
        parameters: {
            query?: never;
            header?: {
                "X-Correlation-Id"?: components["parameters"]["CorrelationId"];
                "Idempotency-Key"?: components["parameters"]["IdempotencyKey"];
            };
            path: {
                runId: string;
            };
            cookie?: never;
        };
        requestBody?: {
            content: {
                "application/json": components["schemas"]["GenericRequest"];
            };
        };
        responses: {
            /** @description Success */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["SopRun"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
            409: components["responses"]["Conflict"];
            422: components["responses"]["Unprocessable"];
            503: components["responses"]["ProviderError"];
        };
    };
    une_sop_016: {
        parameters: {
            query?: never;
            header?: {
                "X-Correlation-Id"?: components["parameters"]["CorrelationId"];
                "Idempotency-Key"?: components["parameters"]["IdempotencyKey"];
            };
            path: {
                runId: string;
            };
            cookie?: never;
        };
        requestBody?: {
            content: {
                "application/json": components["schemas"]["GenericRequest"];
            };
        };
        responses: {
            /** @description Success */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["SopRun"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
            409: components["responses"]["Conflict"];
            422: components["responses"]["Unprocessable"];
            503: components["responses"]["ProviderError"];
        };
    };
    une_task_001: {
        parameters: {
            query?: never;
            header?: {
                "X-Correlation-Id"?: components["parameters"]["CorrelationId"];
            };
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Success */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Task"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
            409: components["responses"]["Conflict"];
            422: components["responses"]["Unprocessable"];
            503: components["responses"]["ProviderError"];
        };
    };
    une_task_002: {
        parameters: {
            query?: never;
            header?: {
                "X-Correlation-Id"?: components["parameters"]["CorrelationId"];
            };
            path: {
                taskId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Success */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Task"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
            409: components["responses"]["Conflict"];
            422: components["responses"]["Unprocessable"];
            503: components["responses"]["ProviderError"];
        };
    };
    une_task_003: {
        parameters: {
            query?: never;
            header?: {
                "X-Correlation-Id"?: components["parameters"]["CorrelationId"];
                "Idempotency-Key"?: components["parameters"]["IdempotencyKey"];
            };
            path: {
                taskId: string;
            };
            cookie?: never;
        };
        requestBody?: {
            content: {
                "application/json": components["schemas"]["TaskActionRequest"];
            };
        };
        responses: {
            /** @description Success */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Task"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
            409: components["responses"]["Conflict"];
            422: components["responses"]["Unprocessable"];
            503: components["responses"]["ProviderError"];
        };
    };
    une_task_004: {
        parameters: {
            query?: never;
            header?: {
                "X-Correlation-Id"?: components["parameters"]["CorrelationId"];
                "Idempotency-Key"?: components["parameters"]["IdempotencyKey"];
            };
            path: {
                taskId: string;
            };
            cookie?: never;
        };
        requestBody?: {
            content: {
                "application/json": components["schemas"]["TaskActionRequest"];
            };
        };
        responses: {
            /** @description Success */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Task"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
            409: components["responses"]["Conflict"];
            422: components["responses"]["Unprocessable"];
            503: components["responses"]["ProviderError"];
        };
    };
    une_task_005: {
        parameters: {
            query?: never;
            header?: {
                "X-Correlation-Id"?: components["parameters"]["CorrelationId"];
                "Idempotency-Key"?: components["parameters"]["IdempotencyKey"];
            };
            path: {
                taskId: string;
            };
            cookie?: never;
        };
        requestBody?: {
            content: {
                "application/json": components["schemas"]["TaskActionRequest"];
            };
        };
        responses: {
            /** @description Success */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Task"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
            409: components["responses"]["Conflict"];
            422: components["responses"]["Unprocessable"];
            503: components["responses"]["ProviderError"];
        };
    };
    une_task_006: {
        parameters: {
            query?: never;
            header?: {
                "X-Correlation-Id"?: components["parameters"]["CorrelationId"];
                "Idempotency-Key"?: components["parameters"]["IdempotencyKey"];
            };
            path: {
                taskId: string;
            };
            cookie?: never;
        };
        requestBody?: {
            content: {
                "application/json": components["schemas"]["TaskActionRequest"];
            };
        };
        responses: {
            /** @description Success */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Task"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
            409: components["responses"]["Conflict"];
            422: components["responses"]["Unprocessable"];
            503: components["responses"]["ProviderError"];
        };
    };
    une_task_007: {
        parameters: {
            query?: never;
            header?: {
                "X-Correlation-Id"?: components["parameters"]["CorrelationId"];
                "Idempotency-Key"?: components["parameters"]["IdempotencyKey"];
            };
            path: {
                taskId: string;
            };
            cookie?: never;
        };
        requestBody?: {
            content: {
                "application/json": components["schemas"]["TaskActionRequest"];
            };
        };
        responses: {
            /** @description Success */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Task"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
            409: components["responses"]["Conflict"];
            422: components["responses"]["Unprocessable"];
            503: components["responses"]["ProviderError"];
        };
    };
    une_task_008: {
        parameters: {
            query?: never;
            header?: {
                "X-Correlation-Id"?: components["parameters"]["CorrelationId"];
                "Idempotency-Key"?: components["parameters"]["IdempotencyKey"];
            };
            path: {
                taskId: string;
            };
            cookie?: never;
        };
        requestBody?: {
            content: {
                "application/json": components["schemas"]["TaskActionRequest"];
            };
        };
        responses: {
            /** @description Success */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Task"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
            409: components["responses"]["Conflict"];
            422: components["responses"]["Unprocessable"];
            503: components["responses"]["ProviderError"];
        };
    };
    une_task_009: {
        parameters: {
            query?: never;
            header?: {
                "X-Correlation-Id"?: components["parameters"]["CorrelationId"];
                "Idempotency-Key"?: components["parameters"]["IdempotencyKey"];
            };
            path: {
                taskId: string;
            };
            cookie?: never;
        };
        requestBody?: {
            content: {
                "application/json": components["schemas"]["TaskActionRequest"];
            };
        };
        responses: {
            /** @description Success */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Task"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
            409: components["responses"]["Conflict"];
            422: components["responses"]["Unprocessable"];
            503: components["responses"]["ProviderError"];
        };
    };
    une_task_010: {
        parameters: {
            query?: never;
            header?: {
                "X-Correlation-Id"?: components["parameters"]["CorrelationId"];
                "Idempotency-Key"?: components["parameters"]["IdempotencyKey"];
            };
            path: {
                taskId: string;
            };
            cookie?: never;
        };
        requestBody?: {
            content: {
                "application/json": components["schemas"]["TaskActionRequest"];
            };
        };
        responses: {
            /** @description Success */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Task"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
            409: components["responses"]["Conflict"];
            422: components["responses"]["Unprocessable"];
            503: components["responses"]["ProviderError"];
        };
    };
    une_task_011: {
        parameters: {
            query?: never;
            header?: {
                "X-Correlation-Id"?: components["parameters"]["CorrelationId"];
                "Idempotency-Key"?: components["parameters"]["IdempotencyKey"];
            };
            path: {
                taskId: string;
            };
            cookie?: never;
        };
        requestBody?: {
            content: {
                "application/json": components["schemas"]["TaskActionRequest"];
            };
        };
        responses: {
            /** @description Success */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Task"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
            409: components["responses"]["Conflict"];
            422: components["responses"]["Unprocessable"];
            503: components["responses"]["ProviderError"];
        };
    };
    une_task_012: {
        parameters: {
            query?: never;
            header?: {
                "X-Correlation-Id"?: components["parameters"]["CorrelationId"];
                "Idempotency-Key"?: components["parameters"]["IdempotencyKey"];
            };
            path: {
                taskId: string;
            };
            cookie?: never;
        };
        requestBody?: {
            content: {
                "application/json": components["schemas"]["TaskActionRequest"];
            };
        };
        responses: {
            /** @description Success */
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Task"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
            409: components["responses"]["Conflict"];
            422: components["responses"]["Unprocessable"];
            503: components["responses"]["ProviderError"];
        };
    };
    une_task_013: {
        parameters: {
            query?: never;
            header?: {
                "X-Correlation-Id"?: components["parameters"]["CorrelationId"];
            };
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Success */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["GenericResponse"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
            409: components["responses"]["Conflict"];
            422: components["responses"]["Unprocessable"];
            503: components["responses"]["ProviderError"];
        };
    };
    une_task_014: {
        parameters: {
            query?: never;
            header?: {
                "X-Correlation-Id"?: components["parameters"]["CorrelationId"];
                "Idempotency-Key"?: components["parameters"]["IdempotencyKey"];
            };
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody?: {
            content: {
                "application/json": components["schemas"]["GenericRequest"];
            };
        };
        responses: {
            /** @description Success */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["GenericResponse"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
            409: components["responses"]["Conflict"];
            422: components["responses"]["Unprocessable"];
            503: components["responses"]["ProviderError"];
        };
    };
    une_jnl_001: {
        parameters: {
            query?: never;
            header?: {
                "X-Correlation-Id"?: components["parameters"]["CorrelationId"];
            };
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Success */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Situation"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
            409: components["responses"]["Conflict"];
            422: components["responses"]["Unprocessable"];
            503: components["responses"]["ProviderError"];
        };
    };
    une_jnl_002: {
        parameters: {
            query?: never;
            header?: {
                "X-Correlation-Id"?: components["parameters"]["CorrelationId"];
            };
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Success */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Situation"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
            409: components["responses"]["Conflict"];
            422: components["responses"]["Unprocessable"];
            503: components["responses"]["ProviderError"];
        };
    };
    une_jnl_003: {
        parameters: {
            query?: never;
            header?: {
                "X-Correlation-Id"?: components["parameters"]["CorrelationId"];
            };
            path: {
                eventId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Success */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["GenericResponse"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
            409: components["responses"]["Conflict"];
            422: components["responses"]["Unprocessable"];
            503: components["responses"]["ProviderError"];
        };
    };
    une_jnl_004: {
        parameters: {
            query?: never;
            header?: {
                "X-Correlation-Id"?: components["parameters"]["CorrelationId"];
                "Idempotency-Key"?: components["parameters"]["IdempotencyKey"];
            };
            path: {
                eventId: string;
            };
            cookie?: never;
        };
        requestBody?: {
            content: {
                "application/json": components["schemas"]["GenericRequest"];
            };
        };
        responses: {
            /** @description Success */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["GenericResponse"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
            409: components["responses"]["Conflict"];
            422: components["responses"]["Unprocessable"];
            503: components["responses"]["ProviderError"];
        };
    };
    une_jnl_005: {
        parameters: {
            query?: never;
            header?: {
                "X-Correlation-Id"?: components["parameters"]["CorrelationId"];
                "Idempotency-Key"?: components["parameters"]["IdempotencyKey"];
            };
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody?: {
            content: {
                "application/json": components["schemas"]["JournalProjectionRequest"];
            };
        };
        responses: {
            /** @description Success */
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Situation"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
            409: components["responses"]["Conflict"];
            422: components["responses"]["Unprocessable"];
            503: components["responses"]["ProviderError"];
        };
    };
    une_jnl_006: {
        parameters: {
            query?: never;
            header?: {
                "X-Correlation-Id"?: components["parameters"]["CorrelationId"];
            };
            path: {
                journalId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Success */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Journal"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
            409: components["responses"]["Conflict"];
            422: components["responses"]["Unprocessable"];
            503: components["responses"]["ProviderError"];
        };
    };
    une_jnl_007: {
        parameters: {
            query?: never;
            header?: {
                "X-Correlation-Id"?: components["parameters"]["CorrelationId"];
                "Idempotency-Key"?: components["parameters"]["IdempotencyKey"];
            };
            path: {
                journalId: string;
            };
            cookie?: never;
        };
        requestBody?: {
            content: {
                "application/json": components["schemas"]["GenericRequest"];
            };
        };
        responses: {
            /** @description Success */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["GenerationJob"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
            409: components["responses"]["Conflict"];
            422: components["responses"]["Unprocessable"];
            503: components["responses"]["ProviderError"];
        };
    };
    une_jnl_008: {
        parameters: {
            query?: never;
            header?: {
                "X-Correlation-Id"?: components["parameters"]["CorrelationId"];
                "Idempotency-Key"?: components["parameters"]["IdempotencyKey"];
            };
            path: {
                journalId: string;
            };
            cookie?: never;
        };
        requestBody?: {
            content: {
                "application/json": components["schemas"]["ChangeSetRequest"];
            };
        };
        responses: {
            /** @description Success */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Journal"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
            409: components["responses"]["Conflict"];
            422: components["responses"]["Unprocessable"];
            503: components["responses"]["ProviderError"];
        };
    };
    une_jnl_009: {
        parameters: {
            query?: never;
            header?: {
                "X-Correlation-Id"?: components["parameters"]["CorrelationId"];
                "Idempotency-Key"?: components["parameters"]["IdempotencyKey"];
            };
            path: {
                journalId: string;
            };
            cookie?: never;
        };
        requestBody?: {
            content: {
                "application/json": components["schemas"]["GenericRequest"];
            };
        };
        responses: {
            /** @description Success */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Journal"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
            409: components["responses"]["Conflict"];
            422: components["responses"]["Unprocessable"];
            503: components["responses"]["ProviderError"];
        };
    };
    une_jnl_010: {
        parameters: {
            query?: never;
            header?: {
                "X-Correlation-Id"?: components["parameters"]["CorrelationId"];
                "Idempotency-Key"?: components["parameters"]["IdempotencyKey"];
            };
            path: {
                journalId: string;
            };
            cookie?: never;
        };
        requestBody?: {
            content: {
                "application/json": components["schemas"]["GenericRequest"];
            };
        };
        responses: {
            /** @description Success */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Journal"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
            409: components["responses"]["Conflict"];
            422: components["responses"]["Unprocessable"];
            503: components["responses"]["ProviderError"];
        };
    };
    une_jnl_011: {
        parameters: {
            query?: never;
            header?: {
                "X-Correlation-Id"?: components["parameters"]["CorrelationId"];
                "Idempotency-Key"?: components["parameters"]["IdempotencyKey"];
            };
            path: {
                journalId: string;
            };
            cookie?: never;
        };
        requestBody?: {
            content: {
                "application/json": components["schemas"]["ExportRequest"];
            };
        };
        responses: {
            /** @description Success */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Journal"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
            409: components["responses"]["Conflict"];
            422: components["responses"]["Unprocessable"];
            503: components["responses"]["ProviderError"];
        };
    };
    une_jnl_012: {
        parameters: {
            query?: never;
            header?: {
                "X-Correlation-Id"?: components["parameters"]["CorrelationId"];
                "Idempotency-Key"?: components["parameters"]["IdempotencyKey"];
            };
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody?: {
            content: {
                "application/json": components["schemas"]["GenericRequest"];
            };
        };
        responses: {
            /** @description Success */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Situation"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
            409: components["responses"]["Conflict"];
            422: components["responses"]["Unprocessable"];
            503: components["responses"]["ProviderError"];
        };
    };
    une_jnl_013: {
        parameters: {
            query?: never;
            header?: {
                "X-Correlation-Id"?: components["parameters"]["CorrelationId"];
                "Idempotency-Key"?: components["parameters"]["IdempotencyKey"];
            };
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody?: {
            content: {
                "application/json": components["schemas"]["EvaluationRequest"];
            };
        };
        responses: {
            /** @description Success */
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Situation"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
            409: components["responses"]["Conflict"];
            422: components["responses"]["Unprocessable"];
            503: components["responses"]["ProviderError"];
        };
    };
    une_jnl_014: {
        parameters: {
            query?: never;
            header?: {
                "X-Correlation-Id"?: components["parameters"]["CorrelationId"];
                "Idempotency-Key"?: components["parameters"]["IdempotencyKey"];
            };
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody?: {
            content: {
                "application/json": components["schemas"]["GenericRequest"];
            };
        };
        responses: {
            /** @description Success */
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["GenericResponse"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
            409: components["responses"]["Conflict"];
            422: components["responses"]["Unprocessable"];
            503: components["responses"]["ProviderError"];
        };
    };
    une_jnl_015: {
        parameters: {
            query?: never;
            header?: {
                "X-Correlation-Id"?: components["parameters"]["CorrelationId"];
            };
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Success */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["GenericResponse"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
            409: components["responses"]["Conflict"];
            422: components["responses"]["Unprocessable"];
            503: components["responses"]["ProviderError"];
        };
    };
    une_admin_001: {
        parameters: {
            query?: never;
            header?: {
                "X-Correlation-Id"?: components["parameters"]["CorrelationId"];
            };
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Success */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["GenericResponse"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
            409: components["responses"]["Conflict"];
            422: components["responses"]["Unprocessable"];
            503: components["responses"]["ProviderError"];
        };
    };
    une_admin_002: {
        parameters: {
            query?: never;
            header?: {
                "X-Correlation-Id"?: components["parameters"]["CorrelationId"];
                "Idempotency-Key"?: components["parameters"]["IdempotencyKey"];
            };
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody?: {
            content: {
                "application/json": components["schemas"]["GenericRequest"];
            };
        };
        responses: {
            /** @description Success */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["GenericResponse"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
            409: components["responses"]["Conflict"];
            422: components["responses"]["Unprocessable"];
            503: components["responses"]["ProviderError"];
        };
    };
    une_admin_003: {
        parameters: {
            query?: never;
            header?: {
                "X-Correlation-Id"?: components["parameters"]["CorrelationId"];
            };
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Success */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["GenericResponse"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
            409: components["responses"]["Conflict"];
            422: components["responses"]["Unprocessable"];
            503: components["responses"]["ProviderError"];
        };
    };
    une_admin_004: {
        parameters: {
            query?: never;
            header?: {
                "X-Correlation-Id"?: components["parameters"]["CorrelationId"];
                "Idempotency-Key"?: components["parameters"]["IdempotencyKey"];
            };
            path?: never;
            cookie?: never;
        };
        requestBody?: {
            content: {
                "application/json": components["schemas"]["GenericRequest"];
            };
        };
        responses: {
            /** @description Success */
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["GenericResponse"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
            409: components["responses"]["Conflict"];
            422: components["responses"]["Unprocessable"];
            503: components["responses"]["ProviderError"];
        };
    };
    une_admin_005: {
        parameters: {
            query?: never;
            header?: {
                "X-Correlation-Id"?: components["parameters"]["CorrelationId"];
            };
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Success */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["GenericResponse"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
            409: components["responses"]["Conflict"];
            422: components["responses"]["Unprocessable"];
            503: components["responses"]["ProviderError"];
        };
    };
    une_admin_006: {
        parameters: {
            query?: never;
            header?: {
                "X-Correlation-Id"?: components["parameters"]["CorrelationId"];
            };
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Success */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["GenericResponse"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
            409: components["responses"]["Conflict"];
            422: components["responses"]["Unprocessable"];
            503: components["responses"]["ProviderError"];
        };
    };
    une_admin_007: {
        parameters: {
            query?: never;
            header?: {
                "X-Correlation-Id"?: components["parameters"]["CorrelationId"];
                "Idempotency-Key"?: components["parameters"]["IdempotencyKey"];
            };
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody?: {
            content: {
                "application/json": components["schemas"]["GenericRequest"];
            };
        };
        responses: {
            /** @description Success */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["GenericResponse"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
            409: components["responses"]["Conflict"];
            422: components["responses"]["Unprocessable"];
            503: components["responses"]["ProviderError"];
        };
    };
    une_admin_008: {
        parameters: {
            query?: never;
            header?: {
                "X-Correlation-Id"?: components["parameters"]["CorrelationId"];
            };
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Success */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["GenericResponse"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
            409: components["responses"]["Conflict"];
            422: components["responses"]["Unprocessable"];
            503: components["responses"]["ProviderError"];
        };
    };
    une_admin_009: {
        parameters: {
            query?: never;
            header?: {
                "X-Correlation-Id"?: components["parameters"]["CorrelationId"];
                "Idempotency-Key"?: components["parameters"]["IdempotencyKey"];
                "If-Match"?: components["parameters"]["IfMatch"];
            };
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody?: {
            content: {
                "application/json": components["schemas"]["GenericRequest"];
            };
        };
        responses: {
            /** @description Success */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["GenericResponse"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
            409: components["responses"]["Conflict"];
            422: components["responses"]["Unprocessable"];
            503: components["responses"]["ProviderError"];
        };
    };
    une_admin_010: {
        parameters: {
            query?: never;
            header?: {
                "X-Correlation-Id"?: components["parameters"]["CorrelationId"];
                "Idempotency-Key"?: components["parameters"]["IdempotencyKey"];
            };
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody?: {
            content: {
                "application/json": components["schemas"]["GenericRequest"];
            };
        };
        responses: {
            /** @description Success */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["GenericResponse"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
            409: components["responses"]["Conflict"];
            422: components["responses"]["Unprocessable"];
            503: components["responses"]["ProviderError"];
        };
    };
    une_admin_011: {
        parameters: {
            query?: never;
            header?: {
                "X-Correlation-Id"?: components["parameters"]["CorrelationId"];
            };
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Success */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["GenericResponse"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
            409: components["responses"]["Conflict"];
            422: components["responses"]["Unprocessable"];
            503: components["responses"]["ProviderError"];
        };
    };
    une_admin_012: {
        parameters: {
            query?: never;
            header?: {
                "X-Correlation-Id"?: components["parameters"]["CorrelationId"];
                "Idempotency-Key"?: components["parameters"]["IdempotencyKey"];
                "If-Match"?: components["parameters"]["IfMatch"];
            };
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody?: {
            content: {
                "application/json": components["schemas"]["GenericRequest"];
            };
        };
        responses: {
            /** @description Success */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["GenericResponse"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
            409: components["responses"]["Conflict"];
            422: components["responses"]["Unprocessable"];
            503: components["responses"]["ProviderError"];
        };
    };
}
