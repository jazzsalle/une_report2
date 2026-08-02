import { describe, expect, it } from 'vitest';
import {
  OFFSET_CONTRIBUTING_ELEMENTS,
  OFFSET_TRANSPARENT_ELEMENTS,
  normalizeOffset,
} from '@une/domain';
import { WHITESPACE_CHARACTERS } from '@une/hwpx-engine';

/**
 * Offset Normalization Contract (CC-150, ADR-30 D5).
 *
 * The offset space a selection addresses is the concatenation of a
 * paragraph's run texts. WHICH XML constructs contribute characters is the
 * definition of that space, not an implementation detail: a client that
 * counts `hp:tab` differently from the server edits at the wrong position,
 * and nothing about the request looks wrong when it happens.
 *
 * Two producers must therefore agree forever — the engine's IR builder
 * (which fills RunIR.text) and the domain contract (which any editor
 * adapter, rhwp included, is checked against). This file is the only place
 * that can see both.
 */

describe('offset space: engine table ≡ domain contract', () => {
  it('contributing elements match exactly, key for key', () => {
    expect(OFFSET_CONTRIBUTING_ELEMENTS).toEqual(WHITESPACE_CHARACTERS);
  });

  it('the values are the specific code points the design fixed, not lookalikes', () => {
    // A plain space where U+00A0 belongs would still "look" right in a diff.
    expect(OFFSET_CONTRIBUTING_ELEMENTS.fwSpace).toBe(' ');
    expect(OFFSET_CONTRIBUTING_ELEMENTS.nbSpace).toBe(' ');
    expect(OFFSET_CONTRIBUTING_ELEMENTS.tab).toBe('	');
    for (const value of Object.values(OFFSET_CONTRIBUTING_ELEMENTS)) {
      expect(value).toHaveLength(1);
    }
  });

  it('transparent elements contribute nothing and never overlap the contributing set', () => {
    for (const name of OFFSET_TRANSPARENT_ELEMENTS) {
      expect(WHITESPACE_CHARACTERS[name]).toBeUndefined();
    }
    // lineBreak/hypen are deliberately absent: counting them would shift
    // every later offset in the paragraph (CC-140 decision, ADR-30 D5).
    expect(OFFSET_TRANSPARENT_ELEMENTS).toContain('lineBreak');
    expect(OFFSET_TRANSPARENT_ELEMENTS).toContain('fieldBegin');
  });
});

describe('offset boundary snapping (§1.8 결합문자·이모지 경계검사)', () => {
  it('never splits a surrogate pair — an emoji is two code units', () => {
    const text = 'a😀b'; // a=1, emoji=2 (U+D83D U+DE00), b=1
    expect(text).toHaveLength(4);
    expect(normalizeOffset(text, 2).offset).toBe(1);
    expect(normalizeOffset(text, 2).adjustments).toContain('SURROGATE_PAIR');
    // Legal boundaries are untouched.
    for (const legal of [0, 1, 3, 4]) {
      expect(normalizeOffset(text, legal).offset).toBe(legal);
      expect(normalizeOffset(text, legal).adjustments).toEqual([]);
    }
  });

  it('never splits a grapheme cluster with combining marks', () => {
    const text = 'éx'; // e + combining acute + x
    expect(normalizeOffset(text, 1).offset).toBe(0);
    expect(normalizeOffset(text, 1).adjustments).toContain('COMBINING_MARK');
    expect(normalizeOffset(text, 2).offset).toBe(2);
  });

  it('snaps BACKWARD so an adjustment can only shrink an edit, never widen it', () => {
    const text = 'a😀b';
    expect(normalizeOffset(text, 2).offset).toBeLessThan(2);
  });

  it('clamps out-of-range offsets instead of trusting the client', () => {
    const text = 'abc';
    expect(normalizeOffset(text, -5).offset).toBe(0);
    expect(normalizeOffset(text, 99).offset).toBe(3);
  });

  it('handles a combining mark immediately after a surrogate pair', () => {
    const text = '😀́'; // emoji + combining mark
    // Offset 2 sits before the mark → snap back past the whole pair.
    expect(normalizeOffset(text, 2).offset).toBe(0);
  });
});
