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
