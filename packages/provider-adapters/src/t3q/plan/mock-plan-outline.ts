/**
 * Shared deterministic outline/content rules for the in-process mocks
 * (CC-125). Both the legacy and target-v2 mocks derive from the SAME
 * PlanContext fields so the port contract test can assert structural
 * equivalence of their canonical outputs (같은 입력 → 동형 트리). Internal
 * module — not exported from the package index.
 */

export interface MockOutlineNode {
  name: string;
  children: MockOutlineNode[];
}

interface BackgroundInfoShape {
  disasterType?: unknown;
  controlPhase?: unknown;
}

export function buildMockOutline(planContext: Record<string, unknown>): {
  title: string;
  sections: MockOutlineNode[];
} {
  const subject = typeof planContext.subject === 'string' ? planContext.subject : '무제 계획';
  const background = (planContext.backgroundInfo ?? {}) as BackgroundInfoShape;
  const disasterType =
    typeof background.disasterType === 'string' ? background.disasterType : '재난';
  const controlPhase =
    typeof background.controlPhase === 'string' ? background.controlPhase : '대비';
  const instruction = (planContext.contentInstruction ?? {}) as { essentialFactors?: unknown };
  const factors = Array.isArray(instruction.essentialFactors)
    ? instruction.essentialFactors.filter((f): f is string => typeof f === 'string').slice(0, 10)
    : [];

  const measureChildren: MockOutlineNode[] =
    factors.length > 0
      ? factors.map((factor, index) => ({ name: `${index + 1}. ${factor}`, children: [] }))
      : [
          { name: `1. ${disasterType} 예방 점검`, children: [] },
          { name: `2. ${disasterType} ${controlPhase} 태세 확립`, children: [] },
        ];

  return {
    title: subject,
    sections: [
      {
        name: 'Ⅰ. 개요',
        children: [
          { name: '1. 추진 배경', children: [] },
          { name: '2. 추진 목표', children: [] },
        ],
      },
      { name: `Ⅱ. ${disasterType} ${controlPhase} 대책`, children: measureChildren },
      {
        name: 'Ⅲ. 행정사항',
        children: [
          { name: '1. 기관별 협조사항', children: [] },
          { name: '2. 예산·보고', children: [] },
        ],
      },
    ],
  };
}

/** Deterministic mock body text per section (leaf sections only). */
export function buildMockSectionText(name: string, disasterType: string): string {
  return `□ ${name.replace(/^[0-9]+\.\s*/, '')} 관련 ${disasterType} 대응 사항을 점검하고 필요한 조치를 시행한다.`;
}
