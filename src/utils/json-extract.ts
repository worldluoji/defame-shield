/**
 * 从 LLM 返回文本中提取 JSON 源串 — markdown ```json 围栏优先, 其次首尾括号
 */
export function extractJsonSource(raw: string, kind: 'object' | 'array' = 'object'): string | null {
  const fence = raw.match(/```(?:json)?\s*\n?([\s\S]+?)\n?```/);
  const text = fence?.[1] ?? raw;
  const open = kind === 'object' ? '{' : '[';
  const close = kind === 'object' ? '}' : ']';
  const first = text.indexOf(open);
  const last = text.lastIndexOf(close);
  if (first >= 0 && last > first) return text.slice(first, last + 1);
  return fence?.[1]?.trim() ?? null;
}

export type LenientParse =
  | { ok: true; data: unknown; repaired: boolean }
  | { ok: false; error: string };

/**
 * 宽松 JSON.parse — 逐级修复 LLM 常见畸形:
 *   1. 原样解析
 *   2. 去尾逗号 (`,}` / `,]`)
 *   3. 遇 "Expected ','" 报错, 在报错偏移处补逗号后重试 (迭代, 上限 12 次)
 *   4. 截断 (maxTokens 打断): 闭合悬挂字符串, 丢弃结尾 `,` / 补 `null` 给悬挂 `:`, 再按栈补全 `}`/`]`
 * 仅当原样解析已失败才进入修复, 尾逗号正则有极低概率误伤字符串内容 — 此时数据本就不可用, 修复优先。
 */
export function parseJsonLenient(text: string): LenientParse {
  const first = attempt(text);
  if (first.ok) return { ok: true, data: first.data, repaired: false };

  let cur = text.replace(/,\s*([}\]])/g, '$1');
  let lastErr = first.error;

  for (let i = 0; i < 12; i++) {
    const r = attempt(cur);
    if (r.ok) return { ok: true, data: r.data, repaired: true };
    lastErr = r.error;
    if (!/Expected ','/.test(r.error)) break;
    const pos = /position (\d+)/.exec(r.error)?.[1];
    if (pos === undefined) break;
    const idx = Number(pos);
    if (!Number.isInteger(idx) || idx < 0 || idx > cur.length) break;
    cur = cur.slice(0, idx) + ',' + cur.slice(idx);
  }

  const closed = closeTruncated(cur);
  if (closed !== null) {
    const r = attempt(closed);
    if (r.ok) return { ok: true, data: r.data, repaired: true };
  }

  return { ok: false, error: lastErr };
}

function attempt(t: string): { ok: true; data: unknown } | { ok: false; error: string } {
  try {
    return { ok: true, data: JSON.parse(t) };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

/** 补全截断的 JSON: 返回 null 表示没有可补的截断 (括号已配平且不在字符串内) */
function closeTruncated(t: string): string | null {
  const stack: string[] = [];
  let inStr = false;
  let esc = false;
  for (const ch of t) {
    if (inStr) {
      if (esc) esc = false;
      else if (ch === '\\') esc = true;
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') inStr = true;
    else if (ch === '{' || ch === '[') stack.push(ch);
    else if (ch === '}' || ch === ']') stack.pop();
  }
  if (!inStr && stack.length === 0) return null;
  let out = t;
  if (inStr) out += '"';
  out = out.replace(/\s+$/, '');
  if (out.endsWith(',')) out = out.slice(0, -1);
  else if (out.endsWith(':')) out += 'null';
  for (let i = stack.length - 1; i >= 0; i--) out += stack[i] === '{' ? '}' : ']';
  return out;
}
