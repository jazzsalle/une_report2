import { describe, expect, it } from 'vitest';
import { extractPrefix } from './outline-pattern';

describe('extractPrefix — §1.6-2/-3', () => {
  it('기호 앞뒤 공백을 trim하지 않고 세 조각으로 나눈다', () => {
    expect(extractPrefix('  ○ (기상특보) 폭염경보')).toEqual({
      leadingWhitespace: '  ',
      literalPrefix: '○',
      trailingWhitespace: ' ',
      remainderLength: '(기상특보) 폭염경보'.length,
    });
  });

  it('실 코퍼스에서 관측된 기호를 전부 인식한다', () => {
    for (const symbol of ['□', '○', 'ㅇ', '-', '―', '※', '*']) {
      expect(extractPrefix(`${symbol} 제목`)?.literalPrefix).toBe(symbol);
    }
  });

  it('전각 공백·탭·NBSP도 공백으로 센다', () => {
    expect(extractPrefix('　 \t□ 제목')?.leadingWhitespace).toBe('　 \t');
  });

  it('숫자·한글·괄호형은 뒤에 공백이 있어야 접두사다 ("6.30"은 날짜다)', () => {
    expect(extractPrefix('1. 개요')?.literalPrefix).toBe('1.');
    expect(extractPrefix('가) 현황')?.literalPrefix).toBe('가)');
    expect(extractPrefix('(1) 조치')?.literalPrefix).toBe('(1)');
    expect(extractPrefix('6.30 폭염 대처상황 보고')).toBeNull();
  });

  it('접두사가 없으면 null', () => {
    expect(extractPrefix('부산광역시')).toBeNull();
    expect(extractPrefix('')).toBeNull();
    expect(extractPrefix('   ')).toBeNull();
  });

  it('같은 기호라도 앞 공백이 다르면 서로 다른 정보를 남긴다(패턴 독립 저장의 근거)', () => {
    const shallow = extractPrefix('※ 참고');
    const deep = extractPrefix('   ※ 참고');
    expect(shallow?.literalPrefix).toBe(deep?.literalPrefix);
    expect(shallow?.leadingWhitespace).not.toBe(deep?.leadingWhitespace);
  });
});
