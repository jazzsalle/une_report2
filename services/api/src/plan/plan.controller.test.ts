import type { Response } from 'express';
import { describe, expect, it, vi } from 'vitest';
import type { ApiRequest } from '../common/request-context';
import { PlanController } from './plan.controller';
import type { PlanService } from './plan.service';

const PLAN_ID = '44444444-4444-4444-4444-444444444444';

function reqFor(): ApiRequest {
  return {
    requestId: 'req_test',
    correlationId: 'corr_test',
    ip: '127.0.0.1',
    headers: {},
    auth: {
      userId: '11111111-1111-1111-1111-111111111111',
      tenantId: '22222222-2222-2222-2222-222222222222',
      sessionId: '33333333-3333-3333-3333-333333333333',
    },
  } as unknown as ApiRequest;
}

const resFake = (): Response => ({ setHeader: vi.fn() }) as unknown as Response;

function controllerWith(service: Partial<Record<keyof PlanService, unknown>>): PlanController {
  return new PlanController(service as unknown as PlanService);
}

describe('PlanController validation', () => {
  it('collects all create violations in one PLAN-4001 response', async () => {
    const controller = controllerWith({});
    await expect(
      controller.create(reqFor(), {
        title: '   ',
        startMode: 'NOPE',
        hazardType: '눈사태',
        managementPhase: '복구',
        templateFileId: PLAN_ID,
      }),
    ).rejects.toMatchObject({
      status: 400,
      code: 'PLAN-4001',
      violations: expect.arrayContaining([
        expect.objectContaining({ field: 'title' }),
        expect.objectContaining({ field: 'startMode' }),
        expect.objectContaining({ field: 'hazardType' }),
        expect.objectContaining({ field: 'managementPhase' }),
        expect.objectContaining({ field: 'templateFileId' }),
      ]),
    });
  });

  it('requires If-Match on PATCH (428) and rejects malformed ETags (400)', async () => {
    const controller = controllerWith({});
    await expect(
      controller.patch(reqFor(), resFake(), PLAN_ID, undefined, { title: 'x' }),
    ).rejects.toMatchObject({ status: 428, code: 'COM-0428' });
    await expect(
      controller.patch(reqFor(), resFake(), PLAN_ID, 'abc', { title: 'x' }),
    ).rejects.toMatchObject({ status: 400, code: 'COM-0400' });
  });

  it('accepts strong ETags, rejects weak ones, and sets the response ETag from the result', async () => {
    const patchMeta = vi.fn(async (..._args: unknown[]) => ({ versionNo: 2 }));
    const controller = controllerWith({ patchMeta });
    const res = resFake();
    await controller.patch(reqFor(), res, PLAN_ID, '"1"', { title: '수정' });
    expect(patchMeta.mock.calls[0][2]).toBe(1);
    expect(res.setHeader).toHaveBeenCalledWith('ETag', '"2"');

    // RFC 7232: If-Match uses strong comparison only.
    await expect(
      controller.patch(reqFor(), resFake(), PLAN_ID, 'W/"1"', { title: 'x' }),
    ).rejects.toMatchObject({ status: 400, code: 'COM-0400' });
  });

  it('rejects a PATCH that touches non-meta fields or is empty', async () => {
    const controller = controllerWith({});
    await expect(
      controller.patch(reqFor(), resFake(), PLAN_ID, '"1"', { status: 'FINAL' }),
    ).rejects.toMatchObject({ code: 'PLAN-4001' });
    await expect(controller.patch(reqFor(), resFake(), PLAN_ID, '"1"', {})).rejects.toMatchObject({
      code: 'PLAN-4001',
    });
  });

  it('rejects non-UUID path params with COM-0400', async () => {
    const controller = controllerWith({});
    await expect(controller.detail(reqFor(), resFake(), 'not-a-uuid')).rejects.toMatchObject({
      status: 400,
      code: 'COM-0400',
    });
  });

  it('rejects a draft body without a context object', async () => {
    const controller = controllerWith({});
    await expect(controller.saveDraft(reqFor(), PLAN_ID, {})).rejects.toMatchObject({
      code: 'PLAN-4001',
    });
  });

  it('rejects a non-object snapshot body with PLAN-422-001', async () => {
    const controller = controllerWith({});
    await expect(
      controller.confirmSnapshot(reqFor(), resFake(), PLAN_ID, [1, 2]),
    ).rejects.toMatchObject({
      status: 422,
      code: 'PLAN-422-001',
    });
  });
});
