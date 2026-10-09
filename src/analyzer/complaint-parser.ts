/**
 * 起诉状拆解器 — 把 markdown 起诉状文本拆成 4 维结构化 JSON (双模式入口)
 * 模块拆分: prompt.ts (AI 提示词) / ai-parse.ts (LLM 输出解析) /
 *          draft-extract.ts (纯正则兜底) / law-utils.ts (共用)
 */
import { readFileSync, existsSync } from 'node:fs';
import { callLLM } from '../llm/client.js';
import { ANALYZER_SYSTEM_PROMPT } from './prompt.js';
import { parseAndValidateLLMJson } from './ai-parse.js';
import { extractByKeywords } from './draft-extract.js';
import type { AnalyzeOptions, AnalyzeResult } from './complaint-types.js';

export async function analyzeComplaint(input: string, opts: AnalyzeOptions = {}): Promise<AnalyzeResult> {
  let text: string;
  if (existsSync(input) && input.endsWith('.md')) text = readFileSync(input, 'utf-8');
  else text = input;

  if (!text || text.trim().length < 50) {
    return { ok: false, error: '起诉状文本过短 (< 50 字), 请提供完整起诉状内容', code: 'parse_error' };
  }

  if (opts.draft) {
    return { ok: true, analysis: extractByKeywords(text, input) };
  }

  const llmResult = await callLLM(
    [
      { role: 'system', content: ANALYZER_SYSTEM_PROMPT },
      {
        role: 'user',
        content: `## 原告起诉状 (Markdown)\n\n${text}\n\n请输出 JSON。` +
          (opts.extraInstruction
            ? `\n\n**律师补充指令** (在不改变上述 JSON 输出格式的前提下遵循): ${opts.extraInstruction}`
            : ''),
      },
    ],
    { provider: opts.provider, temperature: 0.2, maxTokens: 4000 },
  );

  if (!llmResult.ok) {
    // LLM 失败 → draft 兜底: partialDraft 供上层决定是否落盘 (宁缺毋滥, 由命令层呈现)
    const draftAnalysis = extractByKeywords(text, input);
    return {
      ok: false,
      error: `LLM 拆解失败 (${llmResult.code}): ${llmResult.error}\n已 fallback 到 draft 模式`,
      code: 'llm_error',
      partialDraft: draftAnalysis,
    };
  }

  const parsed = parseAndValidateLLMJson(llmResult.text, input);
  if (!parsed.ok) {
    return {
      ok: false,
      error: `LLM 输出解析失败: ${parsed.error}\n原始输出: ${llmResult.text.slice(0, 500)}`,
      code: 'invalid_format',
    };
  }

  return { ok: true, analysis: parsed.analysis };
}
