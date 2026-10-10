/**
 * 宽松日期解析 + 保守年数差 — 单元测试
 */
import { describe, it, expect } from 'vitest';
import { parseLooseDate, elapsedYears, daysSince, defenseDeadline, DEFENSE_PERIOD_DAYS } from '../src/utils/dates';

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

describe('daysSince', () => {
  const now = new Date(2026, 9, 9); // 2026-10-09 本地日

  it('整天数计算', () => {
    expect(daysSince('2026-09-24', now)).toBe(15);
    expect(daysSince('2026 年 10 月 9 日', now)).toBe(0);
  });

  it('日级精度以下 / 未来日期 → null (倒计时宁缺毋滥)', () => {
    expect(daysSince('2026-09', now)).toBeNull();
    expect(daysSince('2026 年', now)).toBeNull();
    expect(daysSince('2026-10-20', now)).toBeNull();
    expect(daysSince('没写过日期', now)).toBeNull();
  });
});

describe('defenseDeadline (答辩期 15 日)', () => {
  const now = new Date(2026, 9, 9);

  it('第 3 日 → 剩 12 日, 不紧急', () => {
    const dl = defenseDeadline('2026-10-06', now)!;
    expect(dl.daysSince).toBe(3);
    expect(dl.remaining).toBe(DEFENSE_PERIOD_DAYS - 3);
    expect(dl.urgent).toBe(false);
  });

  it('第 12 日 → 剩 3 日, 紧急', () => {
    const dl = defenseDeadline('2026-09-27', now)!;
    expect(dl.remaining).toBe(3);
    expect(dl.urgent).toBe(true);
  });

  it('第 20 日 → 已届满 (remaining 为负, 仍紧急)', () => {
    const dl = defenseDeadline('2026-09-19', now)!;
    expect(dl.remaining).toBeLessThan(0);
    expect(dl.urgent).toBe(true);
  });

  it('缺失/不可解析 → null', () => {
    expect(defenseDeadline(undefined, now)).toBeNull();
    expect(defenseDeadline('2026 年 9 月', now)).toBeNull();
  });
});
