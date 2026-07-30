// GENERATED FILE - DO NOT EDIT.
// Regenerate with: pnpm generate:contract-types (source of truth: contracts/openapi).
/* eslint-disable */

export type paths = {
    "/auth/login": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Login
         * @description UNE 계정으로 로그인    →   자체 JWT 발급
         */
        post: operations["uni_auth_login_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/auth/directory": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Directory
         * @description 조직원 전체 명단 조회 (조직도 표시·담당자 검색 등에 사용).\n\n무엇을: UNE HR 시스템의
         *     전체 사용자 명단을 접속키(X-API-Key)로 가져온다.\n왜          : 로그인은 본인 정보만 주므로, 조직 단위 정보가 필요할 때
         *     별도 조회한다.\n인증 : 로그인된 사용자만 호출 가능(JWT 필요). 실제 HR 조회는 서버가 보관한\n              접속키로 수행
         *     하므로 클라이언트에 접속키가 노출되지 않는다.\n\n반환: {\
         */
        get: operations["uni_auth_directory_get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/chat/files/{file_id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Download Generated File
         * @description 서버에 생성·저장된 파일을 다운로드한다.\n\n지원 형식:\n - .json : SOP 매뉴얼
         *     JSON (application/json)\n - .hwpx : 한글 워드 파일 (application/hwp+zip)\n - .svg : 플로차트
         *     벡터 이미지 (image/svg+xml)\n\n파일은 GENERATED_DIR에 {file_id}.{ext} 형태로 저장된다.\n인증 없이 접근 가
         *     능 (다운로드 링크를 공유할 수 있도록 의도적으로 공개)
         */
        get: operations["uni_chat_files_file_id_get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/chat/": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Chat
         * @description 메인 채팅 엔드포인트.\n\nstream=True (기본): SSE 스트리밍으로 응답          →
         *     StreamingResponse 반환\nstream=False        : 일반 JSON 응답  →   rag_query() 결과 반환
         */
        post: operations["uni_chat_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/chat/json": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Chat Json
         * @description SOP JSON을 compns 요소 단위로 SSE 스트리밍하는 백엔드-투-백엔드 전용 엔드포인
         *     트.\n\n■기존 비스트리밍 방식에서 SSE 스트리밍으로 전환한 이유\n 클라이언트가 compns 배열의 각 노드를 수신하는 즉
         *     시 화면에 그릴 수 있도록\n LLM이 생성하는 JSON을 compns 요소 단위로 실시간 분리해서 전송한다.\n 전체 JSON 완성
         *     까지 기다리지 않아도 되므로 체감 응답성이 크게 향상된다.\n\n           ■
         *                                               동작 흐름\n 1. RAG 검색(벡터)            →
         *                                                                         리랭킹(BGE)          →
         *     컨텍스트 조립\n 2. LLM 스트리밍 호출 (chat_stream)\n 3. 버퍼에 청크 누적 + 중괄호 깊이 추적으로 compns 요소
         *     완성 감지\n 4. 요소 완성 즉시 __compn__ SSE 이벤트 발사\n 5. 완료 후 __sources__, __done__, [DONE]
         *     순서로 전송\n\n  ■  SSE 이벤트 포맷\n - {\
         */
        post: operations["uni_chat_json_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/documents/upload": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Upload Document
         * @description 파일 업로드 엔드포인트\n\n[처리 흐름]\n         1. 파일 형식 검증 (MIME 타입 + 확장자
         *     이중 검증)\n     2. 중복 파일 감지 (force=True이면 무시)\n        3. 고유 파일명으로 UPLOAD_DIR에 저장 (원본 파일
         *     명은 filename 필드에 별도 보관)\n       4. DB + _documents 캐시에 \
         */
        post: operations["uni_documents_upload_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/documents/upload-urls": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Upload From Urls
         * @description URL 목록을 받아 각 파일을 다운로드하고 학습 큐에 등록한다.\n\n[처리 흐름]\n               1. 각
         *     URL 다운로드 (최대 60초 타임아웃)\n               2. XML에서 법령명(제목) 추출   → 파일명으로 사용\n 3. UPLOAD_DIR에 저장
         *     \n 4. DB + 캐시 등록            →
         *                           파싱 큐에 추가\n\n[지원 형식]\n 주로 law.go.kr XML 법령 파일 대상.\n \u003C법령
         *     명_한글\u003E 태그에서 제목 자동 추출.\n 일반 XML도 \u003Ctitle\u003E, \u003Cname\u003E 등으로 폴
         *     백.\n\n반환:\n 각 URL별 처리 결과 목록\n {\
         */
        post: operations["uni_documents_upload_urls_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/documents/": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * List Documents
         * @description 문서 목록 반환 (인증 불필요 — 관리 화면에서 누구나 현황 확인 가능)\n\n- category 없
         *     는 문서: 개별 항목으로 반환 (일반 업로드 파일)\n- category 있는 문서: 카테고리별 요약 1줄로 반환\n 예) 대한민국법
         *     5800건 →  {\
         */
        get: operations["uni_documents_get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/documents/{doc_id}/reference": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Get Reference
         * @description 문서의 참고자료(LLM 생성 요약) 조회\n\n반환:\n          {\
         */
        get: operations["uni_documents_doc_id_reference_get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/documents/retry-errors": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Retry Errors
         * @description 오류 상태 문서 전체 수동 재학습\n\n[용도]\n          자동 재시도(_error_retry_loop)를
         *     기다리지 않고\n       관리자가 즉시 모든 오류 문서를 재처리하고 싶을 때 호출\n\n반환:\n            {\
         */
        post: operations["uni_documents_retry_errors_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/documents/{doc_id}/retry-reference": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Retry Reference
         * @description 특정 문서의 참고자료만 재생성\n\n[용도]\n            이미 Qdrant에 인덱싱된 문서의 참고자료
         *     생성이 실패했거나\n        None인 경우, 파싱·인덱싱 없이 참고자료만 다시 생성할 때 사용\n\n인자:\n              doc_id: 재생성
         *     대상 문서 ID\n\n반환:\n        {\
         */
        post: operations["uni_documents_doc_id_retry_reference_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/documents/{doc_id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post?: never;
        /**
         * Delete Doc
         * @description 문서 삭제 (Qdrant 벡터 + DB + 메모리 캐시)\n\n[삭제 권한]\n        - 업로드한 본인\n
         *     - CEO_POSITIONS에 속한 직책 (현재: \
         */
        delete: operations["uni_documents_doc_id_delete"];
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/documents/bulk-folder": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Bulk Folder
         * @description 폴더 내 파일 전체를 백그라운드로 일괄 학습시키는 내부 전용 엔드포인트.\n\n[보안]
         *     localhost(127.0.0.1)에서만 호출 가능 — JWT 불필요.\n[처리] _process_queue에 추가       →
         *                                                                        기존 워커(N_WORKERS
         *     개)가 순차 처리.\n           이미 완료된 파일(파일명 또는 해시 일치)은 자동 스킵.\n\n반환: {\
         */
        post: operations["uni_documents_bulk_folder_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/models/": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * List Models
         * @description 전체 모델 목록 반환 (available 필드로 실제 서빙 여부 표시)\n\n- 로컬 vLLM:
         *     /v1/models로 실제 모델 ID 검증 (서버가 켜있어도 해당 모델 미로드면 false)\n- API 모델: 목록에서 제거됨
         *     (Claude 등 외부 API 미사용)
         */
        get: operations["uni_models_get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/sessions/events": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Session Events
         * @description SSE 엔드포인트 — 세션 변경 이벤트 실시간 수신\n\n[인증]\n            JWT Bearer 토큰을 헤
         *     더 대신 쿼리 파라미터로 받는 이유:\n          EventSource API(브라우저 표준)는 커스텀 헤더를 지원하지 않아\n            ?
         *     token=... 방식으로 전달. _verify_local_token()으로 검증.\n\n[이벤트 포맷 (text/event-stream)]\n
         *     data: {\
         */
        get: operations["uni_sessions_events_get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/sessions/": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * List Sessions
         * @description 현재 사용자의 세션 목록 반환 (최근 수정 순)\n\n반환:\n            {\
         */
        get: operations["uni_sessions_get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/sessions/{session_id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Get Session
         * @description 특정 세션의 정보와 전체 대화 메시지 반환\n\n[보안]\n             WHERE절에 user_name을 추
         *     가하여 다른 사용자의 세션 조회 방지.\n\n반환:\n           {\n        \
         */
        get: operations["uni_sessions_session_id_get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/sessions/{session_id}/model": {
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
         * /sessions/{session_id}/model
         * @description 세션의 사용 모델 변경\n\n[SSE 이벤트 없음]\n          모델 변경은 현재 세션 내에서만 의미
         *     있고 다른 기기에 즉시 전파할 필요가 없어\n            SSE 이벤트를 보내지 않음 (목록 갱신 불필요).\n\n인자:\n
         *     body.model_key: 변경할 모델 키 (기본 \
         */
        patch: operations["uni_sessions_session_id_model_patch"];
        trace?: never;
    };
    "/sessions/{session_id}/title": {
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
         * Update Title
         * @description 세션 제목 변경 + SSE \
         */
        patch: operations["uni_sessions_session_id_title_patch"];
        trace?: never;
    };
    "/sessions/{session_id}/favorite": {
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
         * Update Favorite
         * @description 세션 즐겨찾기 상태 변경 + SSE \
         */
        patch: operations["uni_sessions_session_id_favorite_patch"];
        trace?: never;
    };
    "/sessions/{session_id}/folder": {
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
         * Update Folder
         * @description 세션 폴더 변경 + SSE \
         */
        patch: operations["uni_sessions_session_id_folder_patch"];
        trace?: never;
    };
    "/image/health": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Health
         * @description image-server 가용성 확인. {available: bool} 반환.
         */
        get: operations["uni_image_health_get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/image/": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Create Image
         * @description 이미지를 생성하고 다운로드 정보를 반환한다.\n\n반환:\n              {\n    \
         */
        post: operations["uni_image_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/search/": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Search Knowledge
         * @description 사내 지식베이스(RAG) 검색 — 검색+리랭킹 후 관련 청크를 반환(LLM 생성 없음).\n\n반환:
         *     {\
         */
        post: operations["uni_search_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/health": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Health
         * @description Successful Response
         */
        get: operations["uni_health_get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
};
export type webhooks = Record<string, never>;
export type components = {
    schemas: {
        GenericRequest: {
            [key: string]: unknown;
        };
        LoginRequest: {
            username: string;
            /** Format: password */
            password: string;
        };
        /** @description Actual source endpoint uses file/multipart; UNE Adapter supplies file and metadata */
        DocumentUploadRequest: {
            [key: string]: unknown;
        };
        SearchRequest: {
            query: string;
            top_k?: number;
            filters?: Record<string, never>;
        };
        ChatRequest: {
            query: string;
            /** @default true */
            stream: boolean;
            session_id?: string;
            model?: string;
        };
        JsonChatRequest: {
            query: string;
            session_id?: string;
            /** @default 1.0 */
            schema_version: string;
        };
    };
    responses: never;
    parameters: never;
    requestBodies: never;
    headers: never;
    pathItems: never;
};
export type $defs = Record<string, never>;
export interface operations {
    uni_auth_login_post: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["LoginRequest"];
            };
        };
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        [key: string]: unknown;
                    };
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    uni_auth_directory_get: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        [key: string]: unknown;
                    };
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    uni_chat_files_file_id_get: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                file_id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        [key: string]: unknown;
                    };
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    uni_chat_post: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["ChatRequest"];
            };
        };
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        [key: string]: unknown;
                    };
                    "text/event-stream": string;
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    uni_chat_json_post: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["JsonChatRequest"];
            };
        };
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        [key: string]: unknown;
                    };
                    "text/event-stream": string;
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    uni_documents_upload_post: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["DocumentUploadRequest"];
            };
        };
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        [key: string]: unknown;
                    };
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    uni_documents_upload_urls_post: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["GenericRequest"];
            };
        };
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        [key: string]: unknown;
                    };
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    uni_documents_get: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        [key: string]: unknown;
                    };
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    uni_documents_doc_id_reference_get: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                doc_id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        [key: string]: unknown;
                    };
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    uni_documents_retry_errors_post: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["GenericRequest"];
            };
        };
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        [key: string]: unknown;
                    };
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    uni_documents_doc_id_retry_reference_post: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                doc_id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["GenericRequest"];
            };
        };
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        [key: string]: unknown;
                    };
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    uni_documents_doc_id_delete: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                doc_id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        [key: string]: unknown;
                    };
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    uni_documents_bulk_folder_post: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["GenericRequest"];
            };
        };
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        [key: string]: unknown;
                    };
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    uni_models_get: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        [key: string]: unknown;
                    };
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    uni_sessions_events_get: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        [key: string]: unknown;
                    };
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    uni_sessions_get: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        [key: string]: unknown;
                    };
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    uni_sessions_session_id_get: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                session_id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        [key: string]: unknown;
                    };
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    uni_sessions_session_id_model_patch: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                session_id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["GenericRequest"];
            };
        };
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        [key: string]: unknown;
                    };
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    uni_sessions_session_id_title_patch: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                session_id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["GenericRequest"];
            };
        };
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        [key: string]: unknown;
                    };
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    uni_sessions_session_id_favorite_patch: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                session_id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["GenericRequest"];
            };
        };
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        [key: string]: unknown;
                    };
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    uni_sessions_session_id_folder_patch: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                session_id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["GenericRequest"];
            };
        };
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        [key: string]: unknown;
                    };
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    uni_image_health_get: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        [key: string]: unknown;
                    };
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    uni_image_post: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["GenericRequest"];
            };
        };
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        [key: string]: unknown;
                    };
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    uni_search_post: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["SearchRequest"];
            };
        };
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        [key: string]: unknown;
                    };
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    uni_health_get: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        [key: string]: unknown;
                    };
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
}
