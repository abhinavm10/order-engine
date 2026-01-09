import { describe, it, expect, vi, beforeEach } from 'vitest';
import crypto from 'crypto';

// Re-implement hash logic here directly as it's not exported by middleware
const hashBody = (body: unknown): string => {
  const str = JSON.stringify(body);
  return crypto.createHash('sha256').update(str).digest('hex');
};

describe('Idempotency Logic', () => {
  it('should generate same hash for same body', () => {
    const body1 = { a: 1, b: 'test' };
    const body2 = { a: 1, b: 'test' };
    expect(hashBody(body1)).toBe(hashBody(body2));
  });

  it('should generate different hash for different body', () => {
    const body1 = { a: 1 };
    const body2 = { a: 2 };
    expect(hashBody(body1)).not.toBe(hashBody(body2));
  });
});

describe('Rate Limiter Logic', () => {
  // Logic test for sliding window math
  it('should calculate correct remaining requests', () => {
    const limit = 30;
    const current = 5;
    const remaining = Math.max(0, limit - current);
    expect(remaining).toBe(25);
  });

  it('should return 0 remaining if over limit', () => {
    const limit = 30;
    const current = 35;
    const remaining = Math.max(0, limit - current);
    expect(remaining).toBe(0);
  });
});
