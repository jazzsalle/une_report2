import { describe, expect, it } from 'vitest';
import { ajvErrors, contractValidators, loadJson, loadYaml, readRepoFile } from './contract-loader';

/**
 * CC-115 AC "legacy contract tests": UNE-authored representative payloads
 * (fixtures/README.md — NOT provider-confirmed samples, OB-01/OB-10 OPEN)
 * validated against the transcribed T3Q v0.8.5 contract, plus the structural
 * facts the field gap matrix and CR-T3Q requests rely on.
 */
const LEGACY = ['contracts', 'openapi', 't3q-report-adapter-v0.8.5-une1.yaml'];

const legacy = contractValidators(...LEGACY);
const legacyDoc = loadYaml(...LEGACY);

const fixture = (name: string): Record<string, unknown> =>
  loadJson('tests', 'contract', 'fixtures', 't3q-legacy', name);

const dataOf = (body: Record<string, unknown>): Record<string, unknown> =>
  body.data as Record<string, unknown>;

describe('T3Q legacy RPT-001/002 contract fixtures', () => {
  it('accepts the representative RPT-001 TOC request', () => {
    const body = fixture('rpt-001.request.valid.json');
    expect(Object.keys(body)).toEqual(['data']);
    const validate = legacy.compile('PlanTocData');
    expect(validate(dataOf(body)), ajvErrors(validate)).toBe(true);
  });

  it('accepts the representative RPT-001 TOC response with recursive sections', () => {
    const response = fixture('rpt-001.response.valid.json');
    const validate = legacy.compile('TocResponse');
    expect(validate(response), ajvErrors(validate)).toBe(true);
    // Depth 3 is really present (recursion is exercised, not vacuous).
    const sections = response.sections as { children: { children: unknown[] }[] }[];
    expect(sections[0].children[1].children.length).toBeGreaterThan(0);
  });

  it('accepts the representative RPT-002 content request (TOC sections reused)', () => {
    const body = fixture('rpt-002.request.valid.json');
    const validate = legacy.compile('PlanContentData');
    expect(validate(dataOf(body)), ajvErrors(validate)).toBe(true);
    expect(dataOf(body).sections).toEqual(fixture('rpt-001.response.valid.json').sections);
  });

  it('accepts the representative RPT-002 content response with references', () => {
    const response = fixture('rpt-002.response.valid.json');
    const validate = legacy.compile('ContentResponse');
    expect(validate(response), ajvErrors(validate)).toBe(true);
  });

  it('terminates the SSE transcript with the contract x-sse-done sentinel', () => {
    const paths = legacyDoc.paths as Record<string, { post: Record<string, unknown> }>;
    const sentinel = paths['/model-api/ae894/reports/plan/content'].post['x-sse-done'] as string;
    expect(sentinel).toBeTruthy();

    const transcript = readRepoFile(
      'tests',
      'contract',
      'fixtures',
      't3q-legacy',
      'rpt-002.stream.assumed.sse.txt',
    );
    const dataLines = transcript
      .split(/\r?\n/)
      .filter((line) => line.startsWith('data: '))
      .map((line) => line.slice('data: '.length));
    expect(dataLines.length).toBeGreaterThan(1);
    expect(dataLines.at(-1)).toBe(sentinel);
    // Every non-terminal frame parses as a partial ContentSection.
    const validate = legacy.compile('ContentSection');
    for (const frame of dataLines.slice(0, -1)) {
      const parsed = JSON.parse(frame);
      expect(validate(parsed), ajvErrors(validate)).toBe(true);
    }
  });

  it('rejects a TOC request missing purposeOfDocument', () => {
    const body = fixture('rpt-001.request.valid.json');
    const data = { ...dataOf(body) };
    delete data.purposeOfDocument;
    const validate = legacy.compile('PlanTocData');
    expect(validate(data)).toBe(false);
  });

  it('rejects null optional fields (mapping must omit, not null out)', () => {
    const body = fixture('rpt-001.request.null-location.invalid.json');
    const validate = legacy.compile('PlanTocData');
    expect(validate(dataOf(body))).toBe(false);
  });

  it('rejects PlanContentData-specific defects: missing sections and malformed section nodes', () => {
    const validate = legacy.compile('PlanContentData');
    const valid = dataOf(fixture('rpt-002.request.valid.json'));

    const withoutSections = { ...valid };
    delete withoutSections.sections;
    expect(validate(withoutSections)).toBe(false);

    const namelessSection = {
      ...valid,
      sections: [{ children: [] }],
    };
    expect(validate(namelessSection)).toBe(false);
  });
});

describe('legacy request ↔ UNE PlanContext alignment (gap matrix ground truth)', () => {
  const planContextSchema = loadJson('contracts', 'schemas', 'plan-context.schema.json');

  const compilePlanContext = async (): Promise<(value: unknown) => boolean> => {
    const { default: Ajv2020 } = await import('ajv/dist/2020');
    const { default: addFormats } = await import('ajv-formats');
    const ajv = new Ajv2020({ strict: false, allErrors: true });
    addFormats(ajv);
    return ajv.compile(planContextSchema);
  };

  it('the valid legacy request is composable from real PlanContext values', async () => {
    const validate = await compilePlanContext();
    expect(validate(dataOf(fixture('rpt-001.request.valid.json')))).toBe(true);
  });

  it('legacy accepts values PlanContext rejects: constraints live on the UNE side', async () => {
    const body = fixture('rpt-001.request.out-of-plancontext.json');
    const legacyValidate = legacy.compile('PlanTocData');
    expect(legacyValidate(dataOf(body)), ajvErrors(legacyValidate)).toBe(true);

    const planContextValidate = await compilePlanContext();
    // 홍수 is not one of the 10 PlanContext hazard types.
    expect(planContextValidate(dataOf(body))).toBe(false);
  });

  it('legacy PlanTocData and PlanContext share the same field names (drift alarm)', () => {
    const schemas = (legacyDoc.components as Record<string, unknown>).schemas as Record<
      string,
      { properties: Record<string, { properties?: Record<string, unknown> }> }
    >;
    const legacyTop = Object.keys(schemas.PlanTocData.properties).sort();
    const contextTop = Object.keys(
      (planContextSchema.properties ?? {}) as Record<string, unknown>,
    ).sort();
    expect(legacyTop).toEqual(contextTop);

    const legacyBackground = Object.keys(
      schemas.PlanTocData.properties.backgroundInfo.properties ?? {},
    ).sort();
    const contextBackground = Object.keys(
      ((planContextSchema.properties as Record<string, { properties: Record<string, unknown> }>)
        .backgroundInfo.properties ?? {}) as Record<string, unknown>,
    ).sort();
    expect(legacyBackground).toEqual(contextBackground);
  });

  it('legacy TOC sections carry no stable id — the basis of CR-T3Q-001', () => {
    const schemas = (legacyDoc.components as Record<string, unknown>).schemas as Record<
      string,
      { properties: Record<string, unknown> }
    >;
    expect(Object.keys(schemas.TocSection.properties).sort()).toEqual(['children', 'name']);
  });

  it('keeps the production policy: TLS verification REQUIRED, auth/timeout/rate/error OPEN', () => {
    const policy = legacyDoc['x-production-policy'] as Record<string, string>;
    expect(policy.tlsVerification).toMatch(/REQUIRED/);
    for (const key of ['authentication', 'timeouts', 'rateLimit', 'errorSchema']) {
      expect(policy[key], key).toMatch(/OPEN/);
    }
  });
});
