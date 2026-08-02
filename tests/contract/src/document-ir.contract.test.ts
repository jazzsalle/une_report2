import { describe, expect, it } from 'vitest';
import Ajv2020 from 'ajv/dist/2020';
import addFormats from 'ajv-formats';
import {
  DOCUMENT_COMPATIBILITY_VERDICTS,
  HWPX_FINDING_CODES,
  HWPX_OBJECT_CLASSES,
  documentIrHash,
  type DocumentIR,
} from '@une/domain';
import { loadJson } from './contract-loader';

/**
 * Document IR / Template Profile contract (CC-140, ADR-29 D5).
 *
 * Two directions are checked so schema and code cannot drift apart:
 * 1. instances built from the DOMAIN types validate against the SCHEMA, and a
 *    typo field is actually rejected (additionalProperties is effective);
 * 2. the schema's closed vocabularies are IDENTICAL to the domain unions —
 *    the drift that would otherwise be found only in production.
 */

const irSchema = loadJson('contracts', 'schemas', 'document-ir.schema.json');
const profileSchema = loadJson('contracts', 'schemas', 'template-profile.schema.json');

function compile(schema: Record<string, unknown>) {
  const ajv = new Ajv2020({ strict: false, allErrors: true });
  addFormats(ajv);
  return ajv.compile(schema);
}

const SHA = 'a'.repeat(64);

/** Minimal-but-complete IR exercising every block kind, built from the domain
 * types so a type change breaks compilation here first. */
const sampleIr: DocumentIR = {
  irVersion: '2',
  documentId: 'doc-1',
  revision: null,
  sourceHash: SHA,
  sections: [
    {
      sectionId: 'S-1',
      partPath: 'Contents/section0.xml',
      pageSettings: { rawXmlAnchor: 'Contents/section0.xml#secPr[1]' },
      blocks: [
        {
          kind: 'PARAGRAPH',
          origin: 'SOURCE',
          paragraphId: 'P-1',
          runs: [{ runId: 'R-1', text: '□ 추진 배경', charPrId: 13, controls: [] }],
          styleRef: { paraPrId: 25, charPrId: 13, numberingId: null, styleId: null },
          editState: { editedByUser: false, locked: false },
          rawXmlAnchor: 'Contents/section0.xml#p[1]',
          styleRole: 'OUTLINE_1',
          outlineLevel: 1,
        },
        {
          kind: 'TABLE',
          origin: 'SOURCE',
          tableId: 'T-1',
          rawXmlAnchor: 'Contents/section0.xml#tbl[1]',
          rows: [
            {
              rowId: 'T-1-R1',
              cells: [
                {
                  cellId: 'T-1-R1-C1',
                  rowSpan: 1,
                  colSpan: 2,
                  blocks: [
                    {
                      kind: 'PARAGRAPH',
                      origin: 'SOURCE',
                      paragraphId: 'P-2',
                      runs: [],
                      styleRef: { paraPrId: 3, charPrId: 1, numberingId: null, styleId: null },
                      editState: { editedByUser: false, locked: false },
                      rawXmlAnchor: 'Contents/section0.xml#tbl[1]/tr[1]/tc[1]/p[1]',
                    },
                  ],
                },
              ],
            },
          ],
        },
        {
          kind: 'PRESERVED',
          origin: 'SOURCE',
          preservedId: 'X-1',
          rawXmlAnchor: 'Contents/section0.xml#pic[1]',
          classification: {
            objectClass: 'PRESERVE_ONLY',
            scope: 'ELEMENT',
            reasonCode: 'OBJ-PIC-BINDATA',
            locator: 'Contents/section0.xml#pic[1]',
            evidence: 'hp:pic referencing BinData/image1.BMP',
            capsVerdict: true,
          },
        },
      ],
    },
  ],
  styleIndex: {
    paraPr: [{ id: 25, attributes: { align: 'JUSTIFY' } }],
    charPr: [{ id: 13, attributes: { height: '1000' } }],
    style: [],
    numbering: [],
    bullet: [],
    binData: [{ id: 1, attributes: { name: 'image1.BMP' } }],
  },
  unknownParts: [{ partPath: 'Scripts/headerScript.js', contentType: null, hash: 'b'.repeat(64) }],
  findings: [
    {
      code: 'HWPX-1004',
      severity: 'DEGRADING',
      locator: 'Contents/section0.xml#pic[1]',
      detail: 'unsupported object preserved verbatim',
    },
  ],
};

describe('document-ir.schema.json ↔ @une/domain', () => {
  const validate = compile(irSchema);

  it('accepts an IR built from the domain types (paragraph, table, preserved block)', () => {
    expect(validate(sampleIr), JSON.stringify(validate.errors)).toBe(true);
  });

  it('rejects a typo field — additionalProperties is effective, not decorative', () => {
    expect(validate({ ...sampleIr, sourceHsah: SHA })).toBe(false);
    const paragraph = { ...sampleIr.sections[0].blocks[0], styleRoll: 'OUTLINE_1' };
    const mutated = structuredClone(sampleIr) as unknown as Record<string, never>;
    (mutated as unknown as DocumentIR).sections[0].blocks[0] = paragraph as never;
    expect(validate(mutated)).toBe(false);
  });

  it('rejects a table cell with no blocks (invariant I6)', () => {
    const mutated = structuredClone(sampleIr);
    const table = mutated.sections[0].blocks[1] as Extract<
      (typeof mutated.sections)[0]['blocks'][number],
      { kind: 'TABLE' }
    >;
    table.rows[0].cells[0].blocks = [];
    expect(validate(mutated)).toBe(false);
  });

  it('rejects a non-hex sourceHash and a malformed anchor', () => {
    expect(validate({ ...sampleIr, sourceHash: 'not-a-hash' })).toBe(false);
    const mutated = structuredClone(sampleIr);
    mutated.sections[0].pageSettings.rawXmlAnchor = 'no-hash-separator';
    expect(validate(mutated)).toBe(false);
  });

  it('requires an unknownPart to carry its hash — invariant I4 is unprovable without it', () => {
    const mutated = structuredClone(sampleIr) as unknown as {
      unknownParts: { partPath: string; contentType: string | null }[];
    };
    mutated.unknownParts = [{ partPath: 'Scripts/x.js', contentType: null }];
    expect(validate(mutated)).toBe(false);
  });

  it('rejects a block with no origin — I9 must bite at the contract layer too', () => {
    const mutated = structuredClone(sampleIr) as unknown as {
      sections: { blocks: Record<string, unknown>[] }[];
    };
    delete mutated.sections[0].blocks[0].origin;
    expect(validate(mutated)).toBe(false);
  });

  it('rejects an AUTHORED node that still carries a rawXmlAnchor', () => {
    const mutated = structuredClone(sampleIr) as unknown as {
      sections: { blocks: Record<string, unknown>[] }[];
    };
    mutated.sections[0].blocks[0].origin = 'AUTHORED';
    mutated.sections[0].blocks[0].anchorHint = { relation: 'AFTER', ref: 'P-0' };
    // rawXmlAnchor is still present from the SOURCE fixture — exclusivity must fail it.
    expect(validate(mutated)).toBe(false);
  });

  it('rejects an AUTHORED node with neither anchor nor hint', () => {
    const mutated = structuredClone(sampleIr) as unknown as {
      sections: { blocks: Record<string, unknown>[] }[];
    };
    mutated.sections[0].blocks[0].origin = 'AUTHORED';
    delete mutated.sections[0].blocks[0].rawXmlAnchor;
    expect(validate(mutated)).toBe(false);
  });

  it('ACCEPTS a well-formed AUTHORED node — the constraint must not reject everything', () => {
    const mutated = structuredClone(sampleIr) as unknown as {
      sections: { blocks: Record<string, unknown>[] }[];
    };
    mutated.sections[0].blocks[0].origin = 'AUTHORED';
    delete mutated.sections[0].blocks[0].rawXmlAnchor;
    mutated.sections[0].blocks[0].anchorHint = { relation: 'AFTER', ref: 'P-0' };
    expect(validate(mutated), JSON.stringify(validate.errors)).toBe(true);
  });

  it('a PRESERVED block can never be AUTHORED — it stands for original bytes', () => {
    const mutated = structuredClone(sampleIr) as unknown as {
      sections: { blocks: Record<string, unknown>[] }[];
    };
    mutated.sections[0].blocks[2].origin = 'AUTHORED';
    expect(validate(mutated)).toBe(false);
  });

  it('hashes deterministically and ignores bookkeeping fields', () => {
    expect(documentIrHash(sampleIr)).toBe(documentIrHash(structuredClone(sampleIr)));
    // Same content, different document/revision identity → same hash.
    expect(documentIrHash({ ...sampleIr, documentId: 'doc-2', revision: 'rev-9' })).toBe(
      documentIrHash(sampleIr),
    );
    // Different content → different hash.
    expect(documentIrHash({ ...sampleIr, sourceHash: 'c'.repeat(64) })).not.toBe(
      documentIrHash(sampleIr),
    );
  });
});

describe('closed vocabularies stay identical in schema and code', () => {
  /** Pulls an enum out of the schema by $defs path so a rename fails loudly. */
  const enumAt = (schema: Record<string, unknown>, path: string[]): string[] => {
    let node: unknown = schema;
    for (const key of path) {
      node = (node as Record<string, unknown>)?.[key];
    }
    const values = (node as { enum?: string[] } | undefined)?.enum;
    if (!values) throw new Error(`no enum at ${path.join('/')}`);
    return [...values].sort();
  };

  it('object classes match ADR v1.1 §8.4 in both schema files and the domain union', () => {
    const domain = [...HWPX_OBJECT_CLASSES].sort();
    expect(
      enumAt(irSchema, ['$defs', 'objectClassification', 'properties', 'objectClass']),
    ).toEqual(domain);
    expect(
      enumAt(profileSchema, ['$defs', 'objectClassification', 'properties', 'objectClass']),
    ).toEqual(domain);
  });

  it('document verdicts match §8.6 G15-1 and the domain union', () => {
    expect(enumAt(profileSchema, ['$defs', 'compatibility', 'properties', 'verdict'])).toEqual(
      [...DOCUMENT_COMPATIBILITY_VERDICTS].sort(),
    );
  });

  it('finding codes match Spec §1.4 and the domain union', () => {
    expect(enumAt(irSchema, ['$defs', 'finding', 'properties', 'code'])).toEqual(
      [...HWPX_FINDING_CODES].sort(),
    );
  });

  it('the two layers never share a vocabulary by accident (ADR-29 D2)', () => {
    // REJECT is the ONLY value the two layers legitimately share.
    const shared = HWPX_OBJECT_CLASSES.filter((value) =>
      (DOCUMENT_COMPATIBILITY_VERDICTS as readonly string[]).includes(value),
    );
    expect(shared).toEqual(['REJECT']);
  });

  it('the confidence component set in the schema matches the weighted-sum inputs', () => {
    const required = (
      profileSchema.$defs as Record<string, Record<string, Record<string, Record<string, unknown>>>>
    ).compatibility.properties.components.required as unknown as string[];
    expect(Array.isArray(required)).toBe(true);
    expect([...required].sort()).toEqual(
      [
        'indentHierarchy',
        'positionEvidence',
        'prefixConsistency',
        'repetitionEvidence',
        'semanticHint',
        'styleConsistency',
      ].sort(),
    );
  });
});
