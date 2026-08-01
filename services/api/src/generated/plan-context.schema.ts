// GENERATED FILE - DO NOT EDIT.
// Regenerate with: pnpm generate:contract-types (source of truth: contracts/openapi).
// Source of truth: contracts/schemas/plan-context.schema.json
/* eslint-disable */

export const planContextSchema = {
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "$id": "https://schemas.une.local/plan-context.schema.json",
  "title": "Plan Context Snapshot",
  "type": "object",
  "additionalProperties": false,
  "required": [
    "subject",
    "backgroundInfo",
    "purposeOfDocument"
  ],
  "properties": {
    "subject": {
      "type": "string",
      "minLength": 1,
      "maxLength": 300
    },
    "backgroundInfo": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "disasterType",
        "controlPhase"
      ],
      "properties": {
        "disasterType": {
          "type": "string",
          "enum": [
            "폭염",
            "태풍/호우",
            "지진",
            "황사",
            "산불",
            "감염병",
            "가축질병",
            "다중밀집건축물붕괴대형사고",
            "정부주요시설",
            "학교시설"
          ]
        },
        "controlPhase": {
          "type": "string",
          "enum": [
            "예방",
            "대비"
          ]
        },
        "location": {
          "type": [
            "string",
            "null"
          ],
          "maxLength": 500
        },
        "startTime": {
          "type": [
            "string",
            "null"
          ],
          "format": "date-time"
        },
        "endTime": {
          "type": [
            "string",
            "null"
          ],
          "format": "date-time"
        },
        "reportTime": {
          "type": [
            "string",
            "null"
          ],
          "format": "date-time"
        }
      }
    },
    "contentInstruction": {
      "type": "object",
      "additionalProperties": false,
      "properties": {
        "source": {
          "type": [
            "string",
            "null"
          ],
          "maxLength": 2000
        },
        "essentialFactors": {
          "type": "array",
          "maxItems": 50,
          "items": {
            "type": "string",
            "maxLength": 300
          }
        },
        "writingGuide": {
          "type": [
            "string",
            "null"
          ],
          "maxLength": 2000
        }
      }
    },
    "expressionRule": {
      "type": "object",
      "additionalProperties": false,
      "properties": {
        "tone": {
          "type": [
            "string",
            "null"
          ]
        },
        "maxSentenceLength": {
          "type": [
            "string",
            "null"
          ]
        },
        "paragraphSymbol": {
          "type": [
            "string",
            "null"
          ]
        },
        "bodytextStart": {
          "type": [
            "string",
            "null"
          ]
        }
      }
    },
    "purposeOfDocument": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "goalOfBusiness",
        "role",
        "targetAudiences"
      ],
      "properties": {
        "goalOfBusiness": {
          "type": "string",
          "minLength": 1
        },
        "role": {
          "type": "string",
          "minLength": 1
        },
        "targetAudiences": {
          "type": "array",
          "minItems": 1,
          "uniqueItems": true,
          "items": {
            "type": "string",
            "enum": [
              "중앙정부",
              "지자체",
              "내부보고",
              "대민"
            ]
          }
        }
      }
    },
    "systemPrompt": {
      "type": [
        "string",
        "null"
      ],
      "maxLength": 8000
    }
  }
} as const;
