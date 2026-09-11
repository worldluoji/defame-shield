/**
 * LLM 经常把整篇输出包在 ```markdown 围栏里 — 落盘前剥掉
 */
export function stripMdFence(s: string): string {
  const m = s.match(/^```(?:markdown|md)?[ \t]*\r?\n([\s\S]*?)\r?\n?[ \t]*```\s*$/);
  return (m && m[1] ? m[1] : s).trim();
}
