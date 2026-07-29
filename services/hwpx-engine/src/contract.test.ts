import { describe, expect, it } from 'vitest';
import { NotYetImplementedHwpxEngine } from './contract';

describe('NotYetImplementedHwpxEngine', () => {
  it('rejects analyze until CC-140', async () => {
    await expect(new NotYetImplementedHwpxEngine().analyze()).rejects.toThrow(/CC-140/);
  });

  it('rejects serialize until CC-140', async () => {
    await expect(new NotYetImplementedHwpxEngine().serialize()).rejects.toThrow(/CC-140/);
  });
});
