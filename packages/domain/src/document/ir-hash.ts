import { canonicalHash } from '../canonical-json';
import type { DocumentIR } from './document-ir';

/**
 * `document_revision.ir_hash` (0003, char(64)) — the identity of an IR's
 * CONTENT, computed with the same canonical-JSON rules every other hash in
 * this system uses so api/worker/engine agree byte-for-byte (ADR-29 D3
 * rationale for keeping the engine in TypeScript).
 *
 * Deliberately excluded: `documentId` and `revision`. Those are bookkeeping —
 * the same document content imported twice must hash identically, which is
 * what makes "did this revision actually change anything?" answerable.
 */
export function documentIrHash(ir: DocumentIR): string {
  const { documentId: _documentId, revision: _revision, ...content } = ir;
  return canonicalHash(content);
}
