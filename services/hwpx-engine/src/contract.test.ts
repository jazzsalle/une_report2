import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { HwpxEngine, NotYetImplementedHwpxEngine } from './contract';
import { describeRhwpIntake } from './intake/rhwp-status';
import { synthHwpx } from './testing/synth-hwpx';

describe('HwpxEngine — CC-140이 채운 경로', () => {
  const engine = new HwpxEngine();

  it('analyzePackage/buildIr/classify가 계약대로 이어진다', () => {
    const analysis = engine.analyzePackage({ bytes: synthHwpx('valid') });
    expect(analysis.mimetype).toBe('application/hwp+zip');
    const build = engine.buildIr(analysis);
    expect(build.ir.irVersion).toBe('1');
    expect(build.ir.sourceHash).toBe(analysis.archiveSha256);
    const classification = engine.classify({ analysis, confidence: 0.9 });
    expect(classification.verdict).toBe('LIMITED');
    expect(classification.objects.length).toBeGreaterThan(0);
  });

  it('analyze(path)는 파일에서 읽어 요약을 낸다', async () => {
    // 실 코퍼스 파일 하나를 경로로 읽는 경로까지 확인한다.
    const summary = await engine.analyze(resolve(__dirname, '../../../templete/보고서 양식.hwpx'));
    expect(summary.packageSha256).toHaveLength(64);
    expect(summary.objectCounts.NATIVE_EDIT).toBeGreaterThan(0);
    expect(summary.objectCounts.PRESERVE_ONLY).toBeGreaterThan(0);
  });

  it('serialize는 CC-160까지 거부한다', async () => {
    await expect(engine.serialize('doc', 'out.hwpx')).rejects.toThrow(/CC-160/);
  });

  it('IR 타입은 도메인 정본을 소비할 뿐 재정의하지 않는다(ADR-29 D4)', () => {
    const build = engine.buildIr(engine.analyzePackage({ bytes: synthHwpx('valid') }));
    // DocumentIR의 필수 필드가 전부 채워진다.
    expect(Object.keys(build.ir).sort()).toEqual([
      'documentId',
      'findings',
      'irVersion',
      'revision',
      'sections',
      'sourceHash',
      'styleIndex',
      'unknownParts',
    ]);
    expect(Object.keys(build.ir.styleIndex).sort()).toEqual([
      'binData',
      'bullet',
      'charPr',
      'numbering',
      'paraPr',
      'style',
    ]);
  });
});

describe('NotYetImplementedHwpxEngine', () => {
  it('rejects serialize until CC-160 (CC-140 은 분석까지만 소유한다)', async () => {
    await expect(new NotYetImplementedHwpxEngine().serialize()).rejects.toThrow(/CC-140/);
    await expect(new NotYetImplementedHwpxEngine().serialize()).rejects.toThrow(/CC-160/);
  });
});

describe('describeRhwpIntake', () => {
  it('rhwp 미반입을 상수로 신고한다 (ADR-29 D1 — 파일 존재로 추론하지 않는다)', () => {
    const report = describeRhwpIntake();
    expect(report.status).toBe('RHWP_NOT_IMPORTED');
    expect(report.nextWorkItem).toMatch(/CC-145/);
    expect(report.limitations.join(' ')).toMatch(/rhwp Rust\/WASM Core 미반입/);
    expect(report.capabilities.length).toBeGreaterThan(0);
  });

  it('같은 객체를 돌려주어 상태가 호출마다 흔들리지 않는다', () => {
    expect(describeRhwpIntake()).toBe(describeRhwpIntake());
  });
});
