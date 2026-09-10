/**
 * 宽松日期解析 + 保守年数差 — 单元测试
 */
import { describe, it, expect } from 'vitest';
import { parseLooseDate, elapsedYears } from '../src/utils/dates';

describe('parseLooseDate', () => {
  it('解析 "2021 年 3 月 5 日" (含空格)', () => {
    expect(parseLooseDate('2021 年 3 月 5 日')).toEqual({ y: 2021, m: 3, d: 5 });
  });

  it('解析 "2021年3月" (仅年月)', () => {
    expect(parseLooseDate('2021年3月')).toEqual({ y: 2021, m: 3 });
  });

  it('解析 "2021 年" (仅年份)', () => {
    expect(parseLooseDate('2021 年 3 月'.replace(' 3 月', ''))).toEqual({ y: 2021 });
    expect(parseLooseDate('事发于 2021 年')).toEqual({ y: 2021 });
  });

  it('解析 ISO "2025-09-10"', () => {
    expect(parseLooseDate('2025-09-10')).toEqual({ y: 2025, m: 9, d: 10 });
  });

  it('解析 ISO 年月 "2025-09"', () => {
    expect(parseLooseDate('2025-09')).toEqual({ y: 2025, m: 9 });
  });

  it('无日期文本 → null', () => {
    expect(parseLooseDate('张三是个骗子')).toBeNull();
    expect(parseLooseDate('')).toBeNull();
  });
});

describe('elapsedYears (保守估算)', () => {
  it('满 3 年 + 明确日期 → > 3', () => {
    const from = parseLooseDate('2021 年 3 月 15 日')!;
    const to = parseLooseDate('2025-09-10')!;
    expect(elapsedYears(from, to)).toBeGreaterThan(3);
  });

  it('精度模糊时宁可低估: "2022 年"(起) → "2025 年"(止) 恰好 3 年边界 → 按 2 年算', () => {
    const from = parseLooseDate('2022 年')!;
    const to = parseLooseDate('2025 年')!;
    expect(elapsedYears(from, to)).toBeLessThanOrEqual(3);
  });

  it('2025 侵权 / 2026 起诉 → 不超过 3', () => {
    const from = parseLooseDate('2025 年 6 月')!;
    const to = parseLooseDate('2026 年 3 月')!;
    expect(elapsedYears(from, to)).toBeLessThan(3);
  });
});
