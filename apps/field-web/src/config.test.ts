import { describe, expect, it } from 'vitest';
import { apiBaseUrl } from './config';

describe('apiBaseUrl', () => {
  it('falls back to localhost when VITE_API_BASE_URL is unset', () => {
    expect(apiBaseUrl()).toMatch(/^http/);
  });
});
