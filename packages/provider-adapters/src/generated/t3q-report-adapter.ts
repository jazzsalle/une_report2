// GENERATED FILE - DO NOT EDIT.
// Regenerate with: pnpm generate:contract-types (source of truth: contracts/openapi).
/* eslint-disable */

export type paths = {
    "/model-api/ae894/reports/plan/toc": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** 재난안전계획서 목차 자동생성 */
        post: operations["t3q_rpt_001"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/model-api/ae894/reports/plan/content": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** 재난안전계획서 본문 자동생성 */
        post: operations["t3q_rpt_002"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/model-api/ae894/reports/daily": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** 일일상황일지 자동생성(선택적 Adapter) */
        post: operations["t3q_rpt_003"];
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
        TocSection: {
            name: string;
            children: components["schemas"]["TocSection"][];
        };
        PlanTocData: {
            subject: string;
            backgroundInfo: {
                disasterType: string;
                controlPhase: string;
                location?: string;
                /** Format: date-time */
                startTime?: string;
                /** Format: date-time */
                endTime?: string;
                /** Format: date-time */
                reportTime?: string;
            };
            contentInstruction?: {
                source?: string;
                essentialFactors?: string[];
                writingGuide?: string;
            };
            expressionRule?: {
                tone?: string;
                maxSentenceLength?: string;
                paragraphSymbol?: string;
                bodytextStart?: string;
            };
            purposeOfDocument: {
                goalOfBusiness: string;
                role: string;
                targetAudiences: string[];
            };
            systemPrompt?: string;
        };
        PlanContentData: {
            subject: string;
            backgroundInfo: {
                disasterType: string;
                controlPhase: string;
                location?: string;
                /** Format: date-time */
                startTime?: string;
                /** Format: date-time */
                endTime?: string;
                /** Format: date-time */
                reportTime?: string;
            };
            contentInstruction?: {
                source?: string;
                essentialFactors?: string[];
                writingGuide?: string;
            };
            expressionRule?: {
                tone?: string;
                maxSentenceLength?: string;
                paragraphSymbol?: string;
                bodytextStart?: string;
            };
            purposeOfDocument: {
                goalOfBusiness: string;
                role: string;
                targetAudiences: string[];
            };
            systemPrompt?: string;
            sections: components["schemas"]["TocSection"][];
            /** @default true */
            stream: boolean;
        };
        TocResponse: {
            title: string;
            sections: components["schemas"]["TocSection"][];
        };
        Reference: {
            id: string;
            fileId: string;
            fileName: string;
            page: string;
        };
        ContentSection: {
            name: string;
            content: string;
            references: components["schemas"]["Reference"][];
            children: components["schemas"]["ContentSection"][];
        };
        ContentResponse: {
            sections: components["schemas"]["ContentSection"][];
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
    t3q_rpt_001: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    data: components["schemas"]["PlanTocData"];
                };
            };
        };
        responses: {
            /** @description Generated TOC */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["TocResponse"];
                };
            };
            /** @description Validation error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Provider error */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    t3q_rpt_002: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    data: components["schemas"]["PlanContentData"];
                };
            };
        };
        responses: {
            /** @description JSON or SSE */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ContentResponse"];
                    "text/event-stream": string;
                };
            };
            /** @description Validation error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Provider error */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    t3q_rpt_003: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    data: {
                        [key: string]: unknown;
                    };
                };
            };
        };
        responses: {
            /** @description Generated daily report */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        result: string;
                    };
                };
            };
        };
    };
}
