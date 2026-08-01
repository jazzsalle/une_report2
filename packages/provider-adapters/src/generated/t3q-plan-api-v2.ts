// GENERATED FILE - DO NOT EDIT.
// Regenerate with: pnpm generate:contract-types (source of truth: contracts/openapi).
// Source is a REQUESTED contract (1.0.1-request), NOT T3Q-accepted. Mock-only capability until OB-10 closes; never report as actual T3Q support.
/* eslint-disable */

export type paths = {
    "/model-api/{modelId}/v2/reports/plan/toc": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Request structured plan table-of-contents generation */
        post: operations["requestPlanTocV2"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/model-api/{modelId}/v2/reports/plan/content": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Request all, section, or block content generation */
        post: operations["requestPlanContentV2"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/model-api/{modelId}/v2/reports/plan/edit": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Create a semantic edit proposal for a range, block, or section */
        post: operations["requestPlanSemanticEdit"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/model-api/{modelId}/v2/reports/plan/evidence/search": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Search evidence with page/chunk provenance */
        post: operations["searchPlanEvidence"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/model-api/{modelId}/v2/reports/plan/validate": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Validate structure, evidence coverage, claims, duplication, and expression rules */
        post: operations["validatePlanSemanticContent"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/model-api/{modelId}/v2/generation-jobs/{generationId}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["getGenerationJob"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/model-api/{modelId}/v2/generation-jobs/{generationId}/events": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** SSE with id, sequence, heartbeat, partial blocks, warnings, and terminal event */
        get: operations["streamGenerationEvents"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/model-api/{modelId}/v2/generation-jobs/{generationId}/cancel": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: operations["cancelGenerationJob"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/model-api/{modelId}/v2/generation-jobs/{generationId}/retry": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: operations["retryGenerationJobTargets"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/model-api/{modelId}/v2/reports/plan/references": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Conditional API; use only when no common T3Q ingestion API exists */
        post: operations["registerPlanReferenceDocument"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/model-api/{modelId}/v2/capabilities": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["getPlanProviderCapabilities"];
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
        ClientContext: {
            tenantId: string;
            userId: string;
            organizationId?: string | null;
            /** @default ko-KR */
            locale: string;
            /** @default Asia/Seoul */
            timezone: string;
            clientVersion?: string;
        };
        PlanRequestBase: {
            /** @constant */
            schemaVersion: "2.0";
            requestId: string;
            correlationId: string;
            clientContext: components["schemas"]["ClientContext"];
            planId: string;
            documentId: string;
            baseRevisionId: string;
            planContextSnapshotId: string;
            contextHash: string;
            subject: string;
            backgroundInfo: {
                [key: string]: unknown;
            };
            contentInstruction: {
                [key: string]: unknown;
            };
            expressionRule: {
                /** @constant */
                scope: "body_only";
            } & {
                [key: string]: unknown;
            };
            purposeOfDocument: {
                [key: string]: unknown;
            };
            referenceDocumentIds?: string[];
            systemPromptVersion?: string;
            /** Format: date-time */
            requestedAt: string;
        };
        TocGenerationRequest: components["schemas"]["PlanRequestBase"] & {
            existingOutline?: components["schemas"]["OutlineSection"][];
            generationOption?: {
                preserveSectionIds?: string[];
                maxDepth?: number;
            };
        };
        ContentGenerationRequest: components["schemas"]["PlanRequestBase"] & {
            outline: components["schemas"]["OutlineSection"][];
            /** @enum {string} */
            generationScope: "ALL" | "SECTIONS" | "BLOCKS";
            targetSectionIds?: string[];
            targetBlockIds?: string[];
            protectedBlockIds?: string[];
            existingBlocks?: components["schemas"]["ContentBlock"][];
            generationOption?: {
                /** @default true */
                stream: boolean;
                /** @default true */
                citationRequired: boolean;
                /** @default true */
                partialResultAllowed: boolean;
            };
        };
        OutlineSection: {
            sectionId: string;
            parentSectionId?: string | null;
            outlineLevel: number;
            order: number;
            title: string;
            /**
             * @example BACKGROUND
             * @example CURRENT_STATUS
             * @example OUTLOOK
             * @example ACTION_PLAN
             * @example SCHEDULE
             * @example APPENDIX
             */
            semanticRole: string;
            /** @enum {string} */
            generationPolicy: "GENERATE" | "PRESERVE" | "USER_ONLY" | "REFERENCE_ONLY";
            /** @default false */
            required: boolean;
            instruction?: string;
        };
        ContentBlock: {
            blockId: string;
            sectionId: string;
            /** @enum {string} */
            blockType: "PARAGRAPH" | "BULLET" | "TABLE" | "NOTE" | "CAPTION" | "PLACEHOLDER";
            order: number;
            text: string;
            structuredData?: {
                [key: string]: unknown;
            } | null;
            citations: components["schemas"]["Citation"][];
            warnings: string[];
            /** @enum {string} */
            status: "GENERATED" | "PARTIAL" | "FAILED" | "PRESERVED" | "PROTECTED";
            contentHash?: string;
        };
        Citation: {
            citationId: string;
            sourceId: string;
            documentId: string;
            fileName: string;
            page?: number | null;
            chunkId?: string | null;
            excerpt: string;
            score: number;
            supportsBlockIds?: string[];
            /** Format: date-time */
            retrievedAt: string;
        };
        GenerationAccepted: {
            generationId: string;
            /** @constant */
            status: "QUEUED";
            /** Format: uri-reference */
            statusUrl: string;
            /** Format: uri-reference */
            eventStreamUrl: string;
            /** Format: date-time */
            acceptedAt: string;
            requestId?: string;
            correlationId?: string;
        };
        GenerationStatus: {
            generationId: string;
            /** @enum {string} */
            status: "QUEUED" | "RUNNING" | "PARTIAL" | "COMPLETED" | "CANCELLED" | "FAILED";
            progress: number;
            completedTargetIds: string[];
            failedTargetIds: string[];
            outline?: components["schemas"]["OutlineSection"][];
            blocks?: components["schemas"]["ContentBlock"][];
            warnings?: string[];
            error?: components["schemas"]["ErrorResponse"] | null;
            /** Format: date-time */
            updatedAt?: string;
        };
        SemanticEditRequest: components["schemas"]["PlanRequestBase"] & {
            target: components["schemas"]["EditTarget"];
            instruction: string;
            selectedText?: string;
            surroundingContext?: {
                before?: string;
                after?: string;
            };
            preserveCitationIds?: string[];
            protectedBlockIds?: string[];
        };
        EditTarget: {
            /** @enum {string} */
            targetType: "RANGE" | "BLOCK" | "SECTION";
            sectionId?: string | null;
            blockId?: string | null;
            range?: {
                start?: number;
                end?: number;
            } | null;
        };
        ChangeProposal: {
            proposalId: string;
            baseRevisionId: string;
            operations: {
                /** @enum {string} */
                operationType: "REPLACE_RANGE" | "REPLACE_BLOCK" | "INSERT_BLOCK" | "DELETE_BLOCK";
                targetId?: string | null;
                payload?: {
                    [key: string]: unknown;
                };
            }[];
            proposedBlocks: components["schemas"]["ContentBlock"][];
            citations: components["schemas"]["Citation"][];
            warnings: string[];
        };
        EvidenceSearchRequest: components["schemas"]["PlanRequestBase"] & {
            query: string;
            topK: number;
            filters?: {
                [key: string]: unknown;
            };
            supportsBlockIds?: string[];
        };
        ValidationRequest: components["schemas"]["PlanRequestBase"] & {
            validationTypes: ("SCHEMA" | "CITATION_COVERAGE" | "UNSUPPORTED_CLAIM" | "DUPLICATE_CONTENT" | "EXPRESSION_RULE" | "MISSING_REQUIRED_SECTION")[];
            outline: components["schemas"]["OutlineSection"][];
            blocks: components["schemas"]["ContentBlock"][];
        };
        ValidationIssue: {
            issueId: string;
            type: string;
            /** @enum {string} */
            severity: "INFO" | "WARNING" | "ERROR";
            message: string;
            sectionId?: string | null;
            blockId?: string | null;
            citationId?: string | null;
            suggestedAction?: string;
        };
        ProviderCapabilities: {
            providerBuild: string;
            contractVersions: string[];
            features: {
                tocV2: boolean;
                contentV2: boolean;
                semanticEdit: boolean;
                evidenceSearch: boolean;
                validation: boolean;
                referenceUpload?: boolean;
                jobSse: boolean;
                partialRetry: boolean;
            };
            limits: {
                maxInputChars?: number;
                maxSections?: number;
                maxBlocks?: number;
                maxConcurrentJobsPerTenant?: number;
                maxReferenceFileBytes?: number;
                supportedReferenceMimeTypes?: string[];
            };
        };
        ErrorResponse: {
            code: string;
            message: string;
            retryable: boolean;
            field?: string | null;
            correlationId: string;
            details?: {
                [key: string]: unknown;
            };
        };
    };
    responses: {
        /** @description Asynchronous generation accepted */
        GenerationAccepted: {
            headers: {
                [name: string]: unknown;
            };
            content: {
                "application/json": components["schemas"]["GenerationAccepted"];
            };
        };
        /** @description Standard error */
        Error: {
            headers: {
                [name: string]: unknown;
            };
            content: {
                "application/json": components["schemas"]["ErrorResponse"];
            };
        };
    };
    parameters: {
        ModelId: string;
        GenerationId: string;
    };
    requestBodies: never;
    headers: never;
    pathItems: never;
};
export type $defs = Record<string, never>;
export interface operations {
    requestPlanTocV2: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                modelId: components["parameters"]["ModelId"];
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["TocGenerationRequest"];
            };
        };
        responses: {
            202: components["responses"]["GenerationAccepted"];
            400: components["responses"]["Error"];
            409: components["responses"]["Error"];
            422: components["responses"]["Error"];
        };
    };
    requestPlanContentV2: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                modelId: components["parameters"]["ModelId"];
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["ContentGenerationRequest"];
            };
        };
        responses: {
            202: components["responses"]["GenerationAccepted"];
            400: components["responses"]["Error"];
            409: components["responses"]["Error"];
            422: components["responses"]["Error"];
        };
    };
    requestPlanSemanticEdit: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                modelId: components["parameters"]["ModelId"];
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["SemanticEditRequest"];
            };
        };
        responses: {
            /** @description Change proposal */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ChangeProposal"];
                };
            };
            409: components["responses"]["Error"];
            422: components["responses"]["Error"];
        };
    };
    searchPlanEvidence: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                modelId: components["parameters"]["ModelId"];
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["EvidenceSearchRequest"];
            };
        };
        responses: {
            /** @description Evidence results */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        requestId: string;
                        items: components["schemas"]["Citation"][];
                    };
                };
            };
            422: components["responses"]["Error"];
        };
    };
    validatePlanSemanticContent: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                modelId: components["parameters"]["ModelId"];
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["ValidationRequest"];
            };
        };
        responses: {
            /** @description Validation report */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        valid: boolean;
                        issues: components["schemas"]["ValidationIssue"][];
                    };
                };
            };
        };
    };
    getGenerationJob: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                modelId: components["parameters"]["ModelId"];
                generationId: components["parameters"]["GenerationId"];
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Job status */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["GenerationStatus"];
                };
            };
            404: components["responses"]["Error"];
        };
    };
    streamGenerationEvents: {
        parameters: {
            query?: never;
            header?: {
                "Last-Event-ID"?: string;
            };
            path: {
                modelId: components["parameters"]["ModelId"];
                generationId: components["parameters"]["GenerationId"];
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description text/event-stream; events include job.started, toc.section, content.block, job.warning, job.completed, job.failed, heartbeat */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "text/event-stream": string;
                };
            };
        };
    };
    cancelGenerationJob: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                modelId: components["parameters"]["ModelId"];
                generationId: components["parameters"]["GenerationId"];
            };
            cookie?: never;
        };
        requestBody?: {
            content: {
                "application/json": {
                    reason?: string;
                };
            };
        };
        responses: {
            /** @description Cancel accepted */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["GenerationStatus"];
                };
            };
            409: components["responses"]["Error"];
        };
    };
    retryGenerationJobTargets: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                modelId: components["parameters"]["ModelId"];
                generationId: components["parameters"]["GenerationId"];
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    /** @enum {string} */
                    targetType: "SECTION" | "BLOCK";
                    targetIds: string[];
                    instructionOverride?: string;
                };
            };
        };
        responses: {
            202: components["responses"]["GenerationAccepted"];
            409: components["responses"]["Error"];
        };
    };
    registerPlanReferenceDocument: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                modelId: components["parameters"]["ModelId"];
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "multipart/form-data": {
                    /** Format: binary */
                    file: string;
                    planId: string;
                    documentType?: string;
                    metadataJson?: string;
                };
            };
        };
        responses: {
            /** @description Accepted */
            202: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        referenceDocumentId: string;
                        /** @enum {string} */
                        status: "UPLOADED" | "PROCESSING" | "READY" | "FAILED";
                    };
                };
            };
        };
    };
    getPlanProviderCapabilities: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                modelId: components["parameters"]["ModelId"];
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Contract versions, feature flags, and limits */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ProviderCapabilities"];
                };
            };
        };
    };
}
