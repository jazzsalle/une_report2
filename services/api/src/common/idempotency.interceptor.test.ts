import type { CallHandler, ExecutionContext } from '@nestjs/common';
import type { Reflector } from '@nestjs/core';
import { firstValueFrom, of, throwError } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';
import type { DatabaseService } from '../db/database.service';
import { ApiError } from './api-error';
import type { IdempotentOptions } from './decorators';
import { IdempotencyInterceptor } from './idempotency.interceptor';
import type { ClaimResult, IdempotencyRepository } from './idempotency.repository';

const AUTH = {
  userId: '11111111-1111-1111-1111-111111111111',
  tenantId: '22222222-2222-2222-2222-222222222222',
  sessionId: '33333333-3333-3333-3333-333333333333',
};

interface Fakes {
  interceptor: IdempotencyInterceptor;
  repo: {
    claim: ReturnType<typeof vi.fn>;
    recordSuccess: ReturnType<typeof vi.fn>;
    recordFailure: ReturnType<typeof vi.fn>;
  };
  context: ExecutionContext;
  res: { status: ReturnType<typeof vi.fn> };
}

function build(
  metadata: IdempotentOptions | undefined,
  reqOverrides: Record<string, unknown>,
  claim: ClaimResult = { state: 'CLAIMED' },
): Fakes {
  const repo = {
    claim: vi.fn(async () => claim),
    recordSuccess: vi.fn(async () => {}),
    recordFailure: vi.fn(async () => {}),
  };
  const db = { withTenant: (_t: string, fn: (c: unknown) => unknown) => fn({}) };
  const reflector = { get: () => metadata };
  const res = { status: vi.fn() };
  const req = {
    method: 'POST',
    path: '/api/v1/plans',
    originalUrl: '/api/v1/plans',
    headers: {},
    body: { title: 'x' },
    correlationId: 'corr_test',
    auth: AUTH,
    ...reqOverrides,
  };
  const handler = (): void => {};
  const context = {
    getHandler: () => handler,
    switchToHttp: () => ({ getRequest: () => req, getResponse: () => res }),
  } as unknown as ExecutionContext;
  const interceptor = new IdempotencyInterceptor(
    reflector as unknown as Reflector,
    db as unknown as DatabaseService,
    repo as unknown as IdempotencyRepository,
  );
  return { interceptor, repo, context, res };
}

const next = (result: unknown): CallHandler => ({ handle: () => of(result) });

describe('IdempotencyInterceptor', () => {
  it('passes through routes without @Idempotent metadata', async () => {
    const { interceptor, repo, context } = build(undefined, {});
    const value = await firstValueFrom(interceptor.intercept(context, next('ok')));
    expect(value).toBe('ok');
    expect(repo.claim).not.toHaveBeenCalled();
  });

  it('rejects a missing key on required routes with 400 COM-0400', async () => {
    const { interceptor, context } = build({ required: true, successStatus: 201 }, {});
    await expect(firstValueFrom(interceptor.intercept(context, next('ok')))).rejects.toMatchObject({
      status: 400,
      code: 'COM-0400',
    });
  });

  it('runs without a claim when the key is absent on optional routes', async () => {
    const { interceptor, repo, context } = build({ required: false, successStatus: 200 }, {});
    const value = await firstValueFrom(interceptor.intercept(context, next('ok')));
    expect(value).toBe('ok');
    expect(repo.claim).not.toHaveBeenCalled();
  });

  it('rejects malformed keys', async () => {
    const { interceptor, context } = build(
      { required: true, successStatus: 201 },
      { headers: { 'idempotency-key': 'bad key!' } },
    );
    await expect(firstValueFrom(interceptor.intercept(context, next('ok')))).rejects.toMatchObject({
      status: 400,
      code: 'COM-0400',
    });
  });

  it('claims, runs the handler, and records the success body/status', async () => {
    const { interceptor, repo, context } = build(
      { required: true, successStatus: 201 },
      { headers: { 'idempotency-key': 'key_1' } },
    );
    const envelope = { success: true, data: { planId: 'p1' } };
    const value = await firstValueFrom(interceptor.intercept(context, next(envelope)));
    expect(value).toBe(envelope);
    expect(repo.claim).toHaveBeenCalledOnce();
    const claimArg = repo.claim.mock.calls[0][1] as { endpoint: string; requestHash: string };
    expect(claimArg.endpoint).toBe('POST /api/v1/plans');
    expect(claimArg.requestHash).toMatch(/^[0-9a-f]{64}$/);
    expect(repo.recordSuccess).toHaveBeenCalledOnce();
    expect(repo.recordSuccess.mock.calls[0][2]).toBe(201);
    expect(repo.recordSuccess.mock.calls[0][3]).toBe(envelope);
  });

  it('keys the claim on the concrete path (query stripped), not a route template', async () => {
    const { interceptor, repo, context } = build(
      { required: true, successStatus: 201 },
      {
        headers: { 'idempotency-key': 'key_1' },
        originalUrl: '/api/v1/plans/11111111-2222-3333-4444-555555555555/context-snapshots?x=1',
      },
    );
    await firstValueFrom(interceptor.intercept(context, next('ok')));
    const claimArg = repo.claim.mock.calls[0][1] as { endpoint: string };
    // Path params are resource identifiers: same key+body on another plan
    // must be a separate claim (review B1).
    expect(claimArg.endpoint).toBe(
      'POST /api/v1/plans/11111111-2222-3333-4444-555555555555/context-snapshots',
    );
  });

  it('replays a stored response without running the handler', async () => {
    const stored = { success: true, data: { planId: 'stored' } };
    const { interceptor, context, res } = build(
      { required: true, successStatus: 201 },
      { headers: { 'idempotency-key': 'key_1' } },
      { state: 'REPLAY', status: 201, body: stored },
    );
    const handler = vi.fn(() => of('fresh'));
    const value = await firstValueFrom(interceptor.intercept(context, { handle: handler }));
    expect(value).toBe(stored);
    expect(handler).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(201);
  });

  it('maps MISMATCH and IN_FLIGHT to 409 COM-0409', async () => {
    for (const [state, recoverable] of [
      ['MISMATCH', false],
      ['IN_FLIGHT', true],
    ] as const) {
      const { interceptor, context } = build(
        { required: true, successStatus: 201 },
        { headers: { 'idempotency-key': 'key_1' } },
        { state } as ClaimResult,
      );
      const err = await firstValueFrom(interceptor.intercept(context, next('ok'))).then(
        () => null,
        (e: unknown) => e as ApiError,
      );
      expect(err).toBeInstanceOf(ApiError);
      expect(err?.status).toBe(409);
      expect(err?.code).toBe('COM-0409');
      expect(err?.recoverable).toBe(recoverable);
    }
  });

  it('marks the claim FAILED and rethrows when the handler errors', async () => {
    const { interceptor, repo, context } = build(
      { required: true, successStatus: 201 },
      { headers: { 'idempotency-key': 'key_1' } },
    );
    const boom = new ApiError(422, 'PLAN-422-001', 'invalid');
    await expect(
      firstValueFrom(interceptor.intercept(context, { handle: () => throwError(() => boom) })),
    ).rejects.toBe(boom);
    expect(repo.recordFailure).toHaveBeenCalledOnce();
    expect(repo.recordSuccess).not.toHaveBeenCalled();
  });
});
