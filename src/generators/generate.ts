/**
 * 文书生成器 — 纯模板 (draft) 或 LLM 增强 (AI)
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { caseToVars, renderTemplate, type TemplateVars } from './render.js';
import { callLLM, type LLMResult } from '../llm/client.js';
import type { Case } from '../case/types.js';
import type { DocumentType } from '../types.js';
import type { ModelProvider } from '../llm/client.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const TEMPLATES_DIR = join(__dirname, '..', 'templates');

export interface GenerateOpts {
  case: Case;
  type: DocumentType;
  /** 纯模板模式 — 不调 LLM, 快/可预测/可审计 */
  draft?: boolean;
  /** LLM provider override */
  provider?: ModelProvider;
  /** 给 LLM 的额外指令 (可选) */
  extraInstruction?: string;
}

export interface GenerateSuccess {
  ok: true;
  /** 渲染后的文书内容 (Markdown) */
  content: string;
  /** 是否走了 LLM */
  usedLLM: boolean;
  /** 耗时 (ms) */
  elapsedMs: number;
  /** 生成模式 */
  mode: 'draft' | 'ai';
  provider?: ModelProvider;
}

export interface GenerateError {
  ok: false;
  error: string;
  /** draft fallback 是否成功 — 便于上层告诉用户"AI 失败, 已退回 draft" */
  draftFallback?: GenerateSuccess;
}

export type GenerateResult = GenerateSuccess | GenerateError;

export async function generateDocument(opts: GenerateOpts): Promise<GenerateResult> {
  const start = Date.now();
  const template = loadTemplate(opts.type);
  const vars = caseToVars(opts.case);
  const baseRendered = renderTemplate(template, vars);

  if (opts.draft) {
    return {
      ok: true,
      content: baseRendered,
      usedLLM: false,
      elapsedMs: Date.now() - start,
      mode: 'draft',
    };
  }

  // LLM 增强: 让 LLM 基于模板内容润色/补全
  const llmResult = await callLLM(buildPrompts(baseRendered, opts, vars));
  if (llmResult.ok) {
    return {
      ok: true,
      content: llmResult.text,
      usedLLM: true,
      elapsedMs: Date.now() - start,
      mode: 'ai',
      provider: llmResult.provider,
    };
  }

  // LLM 失败 → fallback 到 draft 模式, 并把错误信息附带
  return {
    ok: false,
    error: `LLM 失败 (${llmResult.code}): ${llmResult.error}\n已 fallback 到 draft 模式, 你可以手动编辑。`,
    draftFallback: {
      ok: true,
      content: baseRendered,
      usedLLM: false,
      elapsedMs: Date.now() - start,
      mode: 'draft',
    },
  };
}

function loadTemplate(type: DocumentType): string {
  const path = join(TEMPLATES_DIR, `${type}.md`);
  return readFileSync(path, 'utf-8');
}

function buildPrompts(
  draftText: string,
  opts: GenerateOpts,
  vars: TemplateVars,
): Array<{ role: 'system' | 'user'; content: string }> {
  const system = `你是一名专业的中国民事诉讼律师，专长名誉权纠纷案件。
你的任务是基于用户提供的"案件事实 + 模板框架"，生成/润色一份**专业、严谨、可直接用于诉讼/律师函场景**的法律文书。

要求：
1. **严格基于事实**：不得编造证据、不得编造当事人陈述、不得添加模板中不存在的"事实"。
2. **法条引用准确**：仅引用真实存在的法律条文（如《民法典》第1024条、第1025条、第1183条等），不得编造条文编号。
3. **语言风格**：法言法语，客观冷静，避免情绪化表达；避免感叹号；句末用句号。
4. **格式保持**：严格保留 Markdown 标题层级（## ###）与表格结构。
5. **若模板中有 "{{ 未填写 }}" 形式的占位符**，保留为 {{ xxx }} 形式以便用户后续填写，不得凭空填补。
6. **若事实摘要不足以支撑某项诉讼请求**，保留该请求但用[需补充：xxx]标注缺失信息。
7. **不要输出任何额外说明**，直接输出完整的文书 Markdown 内容。`;

  const userExtra = opts.extraInstruction ? `\n\n**额外要求**：${opts.extraInstruction}` : '';
  const user = `## 案件基本信息

${JSON.stringify(vars, null, 2)}

## 模板框架 (Draft)

以下是基于案件事实渲染的模板初稿，请在其基础上**润色、提升专业度、补全程序性内容**（如管辖法院填写提示、案号提示等）：

\`\`\`markdown
${draftText}
\`\`\`
${userExtra}

请直接输出润色后的完整文书 Markdown。`;

  return [
    { role: 'system', content: system },
    { role: 'user', content: user },
  ];
}

export { LLMResult };
