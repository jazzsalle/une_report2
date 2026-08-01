import type { Response } from 'express';
import { describe, expect, it, vi } from 'vitest';
import type { ApiRequest } from '../common/request-context';
import type { JobSseService } from './job-sse.service';
import { PlanJobController } from './plan-job.controller';
import { TocJobController } from './toc-job.controller';
import type { TocJobService } from './toc-job.service';
import { TocVersionController } from './toc-version.controller';
import type { TocVersionService } from './toc-version.service';

const PLAN_ID = '44444444-4444-4444-4444-444444444444';
const SNAPSHOT_ID = '55555555-5555-5555-5555-555555555555';
const JOB_ID = '66666666-6666-6666-6666-666666666666';
const VERSION_ID = '77777777-7777-7777-7777-777777777777';

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

const resFake = (): Response =>
  ({
    setHeader: vi.fn(),
    status: vi.fn(),
    flushHeaders: vi.fn(),
    write: vi.fn(),
    end: vi.fn(),
  }) as unknown as Response;

describe('TocJobController validation (UNE-PLAN-009)', () => {
  it('rejects a non-UUID planId with 400 COM-0400', async () => {
    const controller = new TocJobController({} as unknown as TocJobService);
    await expect(
      controller.requestTocJob(reqFor(), 'not-a-uuid', 'k', { contextSnapshotId: SNAPSHOT_ID }),
    ).rejects.toMatchObject({ status: 400, code: 'COM-0400' });
  });

  it('collects body violations in one PLAN-4001 response', async () => {
    const controller = new TocJobController({} as unknown as TocJobService);
    await expect(
      controller.requestTocJob(reqFor(), PLAN_ID, 'k', {
        contextSnapshotId: 'nope',
        generationOption: { additionalInstruction: 'x'.repeat(2001), unknownField: 'y' },
      }),
    ).rejects.toMatchObject({
      status: 400,
      code: 'PLAN-4001',
      violations: expect.arrayContaining([
        expect.objectContaining({ field: 'contextSnapshotId' }),
        expect.objectContaining({ field: 'generationOption.additionalInstruction' }),
        expect.objectContaining({ field: 'generationOption.unknownField' }),
      ]),
    });
  });

  it('passes the raw Idempotency-Key header through to the service', async () => {
    const requestTocJob = vi.fn(async (..._args: unknown[]) => ({ jobId: JOB_ID }));
    const controller = new TocJobController({ requestTocJob } as unknown as TocJobService);
    await controller.requestTocJob(reqFor(), PLAN_ID, 'client-key-1', {
      contextSnapshotId: SNAPSHOT_ID,
      generationOption: { notes: '메모' },
    });
    expect(requestTocJob.mock.calls[0][2]).toEqual({
      contextSnapshotId: SNAPSHOT_ID,
      generationOption: { notes: '메모' },
    });
    expect(requestTocJob.mock.calls[0][3]).toBe('client-key-1');
  });
});

describe('PlanJobController validation (UNE-PLAN-010/011/012/013)', () => {
  it('rejects a non-UUID jobId on every route with 400 COM-0400', async () => {
    const controller = new PlanJobController(
      {} as unknown as TocJobService,
      {} as unknown as JobSseService,
    );
    await expect(controller.getJob(reqFor(), 'nope')).rejects.toMatchObject({ code: 'COM-0400' });
    await expect(controller.cancel(reqFor(), 'nope', {})).rejects.toMatchObject({
      code: 'COM-0400',
    });
    await expect(controller.retry(reqFor(), 'nope', {})).rejects.toMatchObject({
      code: 'COM-0400',
    });
    await expect(controller.events(reqFor(), resFake(), 'nope', undefined)).rejects.toMatchObject({
      code: 'COM-0400',
    });
  });

  it('rejects an oversized cancel reason with 400 COM-0400', async () => {
    const controller = new PlanJobController(
      {} as unknown as TocJobService,
      {} as unknown as JobSseService,
    );
    await expect(
      controller.cancel(reqFor(), JOB_ID, { reason: 'x'.repeat(501) }),
    ).rejects.toMatchObject({
      status: 400,
      code: 'COM-0400',
      violations: [expect.objectContaining({ field: 'reason' })],
    });
  });

  it('forwards blockIds to the service (the 400 PLAN-4001 is a domain rule)', async () => {
    const retryJob = vi.fn(async (..._args: unknown[]) => ({ jobId: JOB_ID }));
    const controller = new PlanJobController(
      { retryJob } as unknown as TocJobService,
      {} as unknown as JobSseService,
    );
    await controller.retry(reqFor(), JOB_ID, { reason: ' 재시도 ', blockIds: [VERSION_ID] });
    expect(retryJob.mock.calls[0][2]).toEqual({ reason: '재시도', blockIds: [VERSION_ID] });
  });

  it('streams frames manually: SSE headers, id/event/data framing, Last-Event-ID forwarded', async () => {
    const { of } = await import('rxjs');
    const stream = vi.fn(async (..._args: unknown[]) =>
      of({ id: '3', type: 'job.completed', data: '{"x":1}' }),
    );
    const controller = new PlanJobController(
      {} as unknown as TocJobService,
      { stream } as unknown as JobSseService,
    );
    const res = resFake();
    const req = reqFor();
    (req as unknown as { on: (event: string, cb: () => void) => void }).on = vi.fn();
    await controller.events(req, res, JOB_ID, '12');

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.setHeader).toHaveBeenCalledWith('Content-Type', 'text/event-stream');
    expect(res.setHeader).toHaveBeenCalledWith('X-Accel-Buffering', 'no');
    expect(res.setHeader).toHaveBeenCalledWith('Cache-Control', 'no-cache');
    expect(res.flushHeaders).toHaveBeenCalled();
    expect(res.write).toHaveBeenCalledWith('id: 3\nevent: job.completed\ndata: {"x":1}\n\n');
    expect(res.end).toHaveBeenCalled(); // terminal observable completes the response
    expect(stream.mock.calls[0][2]).toBe('12');
  });

  it('rejects a missing job before any SSE header is written (404 as JSON envelope)', async () => {
    const stream = vi.fn(async () => {
      throw Object.assign(new Error('nope'), { status: 404, code: 'JOB-404-001' });
    });
    const controller = new PlanJobController(
      {} as unknown as TocJobService,
      { stream } as unknown as JobSseService,
    );
    const res = resFake();
    await expect(controller.events(reqFor(), res, JOB_ID, undefined)).rejects.toMatchObject({
      code: 'JOB-404-001',
    });
    expect(res.status).not.toHaveBeenCalled();
    expect(res.flushHeaders).not.toHaveBeenCalled();
  });
});

describe('TocVersionController validation (UNE-PLAN-014/015)', () => {
  it('rejects a malformed body with 400 COM-0400 (PLAN-4001 is not in the contract here)', async () => {
    const controller = new TocVersionController({} as unknown as TocVersionService);
    await expect(
      controller.save(reqFor(), PLAN_ID, {
        baseVersionId: 'nope',
        tocTree: [{ title: 42 }, 'x'],
        confirm: 'yes',
      }),
    ).rejects.toMatchObject({
      status: 400,
      code: 'COM-0400',
      violations: expect.arrayContaining([
        expect.objectContaining({ field: 'baseVersionId' }),
        expect.objectContaining({ field: 'tocTree/0/title' }),
        expect.objectContaining({ field: 'tocTree/1' }),
        expect.objectContaining({ field: 'confirm' }),
      ]),
    });
  });

  it('lets an empty tocTree reach the domain validator (422 PLAN-422-002, not 400)', async () => {
    const saveVersion = vi.fn(async (..._args: unknown[]) => ({ tocVersionId: VERSION_ID }));
    const controller = new TocVersionController({ saveVersion } as unknown as TocVersionService);
    await controller.save(reqFor(), PLAN_ID, { baseVersionId: VERSION_ID, tocTree: [] });
    expect(saveVersion.mock.calls[0][2]).toEqual({
      baseVersionId: VERSION_ID,
      tocTree: [],
      confirm: false,
    });
  });

  it('validates both path parameters on the read route', async () => {
    const controller = new TocVersionController({} as unknown as TocVersionService);
    await expect(controller.get(reqFor(), PLAN_ID, 'nope')).rejects.toMatchObject({
      status: 400,
      code: 'COM-0400',
      violations: [expect.objectContaining({ field: 'id' })],
    });
  });
});
