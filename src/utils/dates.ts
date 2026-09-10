/**
 * 宽松日期解析 — 起诉状里的日期格式极不规范:
 *   "2021 年 3 月 5 日" / "2021年3月" / "2021-03-05" / "2021 年"
 */

export interface LooseDate {
  y: number;
  m?: number;
  d?: number;
}

const MS_PER_YEAR = 365.25 * 24 * 3600 * 1000;

/** 从任意文本中解析第一个日期; 解析不出返回 null */
export function parseLooseDate(s: string): LooseDate | null {
  const n = (v: string) => parseInt(v, 10);
  const full = s.match(/(\d{4})\s*[-年./]\s*(\d{1,2})\s*[-月./]\s*(\d{1,2})/);
  if (full) return { y: n(full[1]!), m: n(full[2]!), d: n(full[3]!) };
  const ym = s.match(/(\d{4})\s*[-年./]\s*(\d{1,2})\s*月?/);
  if (ym) return { y: n(ym[1]!), m: n(ym[2]!) };
  const y = s.match(/(\d{4})\s*年/);
  if (y) return { y: n(y[1]!) };
  return null;
}

/** 精度所允许的最晚时点 (年→12-31, 年月→当月最后一天) */
function latestMs(t: LooseDate): number {
  if (!t.m) return Date.UTC(t.y, 11, 31);
  if (!t.d) return Date.UTC(t.y, t.m, 0);
  return Date.UTC(t.y, t.m - 1, t.d);
}

/** 精度所允许的最早时点 (年→01-01, 年月→当月 1 日) */
function earliestMs(t: LooseDate): number {
  if (!t.m) return Date.UTC(t.y, 0, 1);
  if (!t.d) return Date.UTC(t.y, t.m - 1, 1);
  return Date.UTC(t.y, t.m - 1, t.d);
}

/**
 * 保守估算两个日期之间经过的年数:
 * 起点取最晚可能时点, 终点取最早可能时点 — 只会低估不会高估,
 * 避免把未超期的案件误判为已超过诉讼时效。
 */
export function elapsedYears(from: LooseDate, to: LooseDate): number {
  return Math.max(0, (earliestMs(to) - latestMs(from)) / MS_PER_YEAR);
}
