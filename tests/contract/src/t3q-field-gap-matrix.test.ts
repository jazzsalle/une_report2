import { describe, expect, it } from 'vitest';
import { loadJson, loadYaml, readRepoFile } from './contract-loader';

/**
 * CC-115 AC "field gap matrix" drift guard: table 1 of
 * docs/handoff/T3Q_PLAN_FIELD_GAP_MATRIX.md must stay true against its three
 * sources. A failure here means the matrix document needs updating (that is
 * the point — it is a drift alarm, not a flake).
 */

interface MatrixRow {
  planContext: string | null;
  legacy: string | null;
  targetV2: string | null;
}

function parseMatrix(): MatrixRow[] {
  const doc = readRepoFile('docs', 'handoff', 'T3Q_PLAN_FIELD_GAP_MATRIX.md');
  const lines = doc.split(/\r?\n/);
  const header = lines.findIndex((line) => line.startsWith('| PlanContext |'));
  expect(header, 'table 1 header found').toBeGreaterThan(-1);
  const rows: MatrixRow[] = [];
  for (let i = header + 2; i < lines.length; i += 1) {
    const line = lines[i];
    if (!line.startsWith('|')) break;
    const cells = line.split('|').map((cell) => cell.trim());
    // ['', col1, col2, col3, col4, '']
    const value = (cell: string): string | null => (cell === '-' ? null : cell);
    rows.push({ planContext: value(cells[1]), legacy: value(cells[2]), targetV2: value(cells[3]) });
  }
  expect(rows.length).toBeGreaterThan(20);
  return rows;
}

type SchemaNode = {
  properties?: Record<string, SchemaNode>;
  items?: SchemaNode;
  allOf?: SchemaNode[];
};

/** Resolves a dotted property path across properties/allOf composition. */
function hasPath(schema: SchemaNode, dotted: string): boolean {
  let nodes: SchemaNode[] = [schema];
  for (const segment of dotted.split('.')) {
    const next: SchemaNode[] = [];
    for (const node of nodes) {
      const candidates = [node, ...(node.allOf ?? [])];
      for (const candidate of candidates) {
        const child = candidate.properties?.[segment];
        if (child) next.push(child);
      }
    }
    if (next.length === 0) return false;
    nodes = next;
  }
  return true;
}

const planContext = loadJson('contracts', 'schemas', 'plan-context.schema.json') as SchemaNode;
const legacySchemas = (
  loadYaml('contracts', 'openapi', 't3q-report-adapter-v0.8.5-une1.yaml').components as {
    schemas: Record<string, SchemaNode>;
  }
).schemas;
const v2Schemas = (
  loadYaml('contracts', 'openapi', 't3q-plan-api-change-request-v1.yaml').components as {
    schemas: Record<string, SchemaNode>;
  }
).schemas;

function hasContractPath(schemas: Record<string, SchemaNode>, cell: string, label: string): void {
  const [schemaName, ...rest] = cell.split('.');
  const schema = schemas[schemaName];
  expect(schema, `${label}: schema ${schemaName} exists`).toBeDefined();
  if (rest.length > 0) {
    expect(hasPath(schema, rest.join('.')), `${label}: ${cell} exists`).toBe(true);
  }
}

/** Leaf paths of the PlanContext schema (arrays and scalars are leaves). */
function planContextLeaves(node: SchemaNode, prefix = ''): string[] {
  if (!node.properties) return prefix ? [prefix] : [];
  const leaves: string[] = [];
  for (const [key, child] of Object.entries(node.properties)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (child.properties) leaves.push(...planContextLeaves(child, path));
    else leaves.push(path);
  }
  return leaves;
}

describe('T3Q field gap matrix drift', () => {
  const rows = parseMatrix();

  it('every non-empty cell references a real path in its source', () => {
    for (const row of rows) {
      if (row.planContext) {
        expect(hasPath(planContext, row.planContext), `PlanContext: ${row.planContext}`).toBe(true);
      }
      if (row.legacy) hasContractPath(legacySchemas, row.legacy, 'legacy');
      if (row.targetV2) hasContractPath(v2Schemas, row.targetV2, 'target-v2');
    }
  });

  it('rows map corresponding fields, not merely existing ones (review R1)', () => {
    // The mapped cells of one row must talk about the same field: their final
    // path segments must agree. Catches swapped rows that pure existence
    // checks cannot.
    const last = (dotted: string): string => dotted.split('.').at(-1) as string;
    for (const row of rows) {
      if (row.planContext && row.legacy) {
        expect(last(row.legacy), `legacy cell of ${row.planContext}`).toBe(last(row.planContext));
      }
      if (row.planContext && row.targetV2) {
        expect(last(row.targetV2), `target-v2 cell of ${row.planContext}`).toBe(
          last(row.planContext),
        );
      }
    }
  });

  it('covers every PlanContext leaf path (update the matrix when the schema grows)', () => {
    const covered = new Set(rows.map((row) => row.planContext).filter(Boolean));
    for (const leaf of planContextLeaves(planContext)) {
      expect(covered.has(leaf), `matrix row for PlanContext ${leaf}`).toBe(true);
    }
  });

  it('covers every legacy request property (PlanTocData + PlanContentData extras)', () => {
    const covered = new Set(rows.map((row) => row.legacy).filter(Boolean));
    for (const key of Object.keys(legacySchemas.PlanTocData.properties ?? {})) {
      const hit = [...covered].some(
        (cell) => cell === `PlanTocData.${key}` || cell?.startsWith(`PlanTocData.${key}.`),
      );
      expect(hit, `matrix row for PlanTocData.${key}`).toBe(true);
    }
    for (const key of Object.keys(legacySchemas.PlanContentData.properties ?? {})) {
      const hit = [...covered].some(
        (cell) =>
          cell === `PlanContentData.${key}` ||
          cell?.startsWith(`PlanContentData.${key}.`) ||
          cell === `PlanTocData.${key}` ||
          cell?.startsWith(`PlanTocData.${key}.`),
      );
      expect(hit, `matrix row for PlanContentData.${key}`).toBe(true);
    }
  });

  it('covers every PlanRequestBase field (required and optional)', () => {
    const covered = new Set(rows.map((row) => row.targetV2).filter(Boolean));
    const base = v2Schemas.PlanRequestBase as SchemaNode & { required?: string[] };
    for (const key of Object.keys(base.properties ?? {})) {
      const hit = [...covered].some(
        (cell) => cell === `PlanRequestBase.${key}` || cell?.startsWith(`PlanRequestBase.${key}.`),
      );
      expect(hit, `matrix row for PlanRequestBase.${key}`).toBe(true);
    }
    expect(base.required?.length, 'PlanRequestBase.required stays 15+').toBeGreaterThanOrEqual(15);
  });
});
