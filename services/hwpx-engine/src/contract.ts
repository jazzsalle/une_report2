/**
 * Stable service contract for the HWPX analysis/serialization boundary.
 *
 * The rhwp Rust/WASM core is NOT imported yet: ADR-15 requires recording the
 * pinned tag/commit, archive SHA-256, license, SBOM, and patch manifest before
 * any rhwp source enters this repository (see docs/design-markdown/03_ADR_v1.1.md §8
 * and OB-12). CC-140 performs the actual intake behind this contract.
 */

/** Object handling classes fixed by the HWPX rules in CLAUDE.md. */
export type HwpxObjectClass = 'NATIVE_EDIT' | 'PRESERVE_ONLY' | 'FLATTEN_EXPORT_ONLY' | 'REJECT';

export interface HwpxAnalysisSummary {
  /** SHA-256 of the imported package, recorded for provenance. */
  packageSha256: string;
  objectCounts: Partial<Record<HwpxObjectClass, number>>;
}

export interface HwpxEngineContract {
  /** Analyze an imported HWPX package and classify its objects. */
  analyze(packagePath: string): Promise<HwpxAnalysisSummary>;
  /** Preservation-serialize the current document state back to HWPX. */
  serialize(documentId: string, outputPath: string): Promise<void>;
}

/** Placeholder implementation so callers can wire dependency injection early. */
export class NotYetImplementedHwpxEngine implements HwpxEngineContract {
  analyze(): Promise<HwpxAnalysisSummary> {
    return Promise.reject(
      new Error('HWPX engine arrives with CC-140 (rhwp intake gated by ADR-15)'),
    );
  }

  serialize(): Promise<void> {
    return Promise.reject(
      new Error('HWPX engine arrives with CC-140 (rhwp intake gated by ADR-15)'),
    );
  }
}
