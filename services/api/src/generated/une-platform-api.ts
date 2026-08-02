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
         */
        post: operations["une_doc_002"];
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
        get?: never;
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
         *     핵심 요청: factIds,resolutionIds,effectiveAt,reason
         *
         *     핵심 응답: SituationSnapshot
         *
         *     오류: SIT-412-003,SIT-422-006
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
        HwpImportRequest: {
            /** Format: uuid */
            fileId: string;
            /** Format: uuid */
            planId?: string | null;
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
            format: "HWPX" | "PDF" | "DOCX" | "JSON";
            /** Format: uuid */
            revisionId?: string | null;
        };
        SituationCreateRequest: {
            /** @enum {string} */
            mode: "LIVE" | "EXERCISE";
            title: string;
            hazardType: string;
            /** Format: date-time */
            occurredAt?: string | null;
            location?: string | null;
        };
        ProviderQueryRequest: {
            providers: ("KMA" | "MOIS" | "SAFEKOREA" | "NAVER" | "T3Q")[];
            query: Record<string, never>;
            /** Format: date-time */
            from?: string | null;
            /** Format: date-time */
            to?: string | null;
        };
        SituationSnapshotCreateRequest: {
            factIds: string[];
            conflictResolutionIds?: string[];
            /** Format: date-time */
            effectiveAt: string;
            reason?: string | null;
        };
        KnowledgeDocumentCreateRequest: {
            /** Format: uuid */
            fileId: string;
            documentType: string;
            metadata?: Record<string, never>;
        };
        EvidenceSearchRequest: {
            query: string;
            filters?: Record<string, never>;
            topK: number;
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
        Situation: {
            [key: string]: unknown;
        };
        SituationSnapshot: {
            [key: string]: unknown;
        };
        SopRun: {
            [key: string]: unknown;
        };
        Task: {
            [key: string]: unknown;
        };
        Journal: {
            [key: string]: unknown;
        };
        ExportJob: {
            [key: string]: unknown;
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
        requestBody?: {
            content: {
                "application/json": components["schemas"]["HwpImportRequest"];
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
                    "application/json": components["schemas"]["ExportJob"];
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
                    "application/json": components["schemas"]["ExportJob"];
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
                    "application/octet-stream": string;
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
        requestBody?: {
            content: {
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
        requestBody?: {
            content: {
                "application/json": components["schemas"]["ProviderQueryRequest"];
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
    une_sit_010: {
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
    une_sit_013: {
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
                    "application/json": components["schemas"]["SituationSnapshot"];
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
        requestBody?: {
            content: {
                "application/json": components["schemas"]["SituationSnapshotCreateRequest"];
            };
        };
        responses: {
            /** @description Success */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["SituationSnapshot"];
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
        requestBody?: {
            content: {
                "application/json": components["schemas"]["KnowledgeDocumentCreateRequest"];
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
        requestBody?: {
            content: {
                "application/json": components["schemas"]["GenericRequest"];
            };
        };
        responses: {
            /** @description Success */
            202: {
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
        requestBody?: {
            content: {
                "application/json": components["schemas"]["EvidenceSearchRequest"];
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
