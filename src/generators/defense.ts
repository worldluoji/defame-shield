/**
 * 答辩状生成器 (v2) — 基于"起诉状拆解 + 反驳策略"生成
 *
 * 与 v1 的区别:
 *   v1: 反着套答辩模板 (套话, 无针对性)
 *   v2: 逐条诉请匹配反点, 用反点模板填充 + 类案参考
 *
 * 输入: ComplaintAnalysis (拆解结果) + 案件 (被告方信息)
 * 输出: Markdown 答辩状
 */

import { callLLM, type LLMResult } from '../llm/client.js';
import { selectStrategies, selectStrategyForClaim, type RebuttalStrategy } from '../rebuttal/strategies.js';
import type { ComplaintAnalysis, ParsedClaim, CaseReference } from '../analyzer/complaint-types.js';
import type { Case } from '../case/types.js';

export interface DefenseGenerateOpts {
  /** 拆解结果 */
  analysis: ComplaintAnalysis;
  /** 案件 (被告信息 / 律师 / 管辖法院等) */
  case: Case;
  /** 纯模板模式 (不调 LLM 润色) */
  draft?: boolean;
  /** LLM provider */
  provider?: 'deepseek' | 'minimax';
  /** 额外指令 */
  extraInstruction?: string;
}

export type DefenseResult =
  | { ok: true; content: string; usedLLM: boolean; mode: 'draft' | 'ai'; strategies: RebuttalStrategy[]; caseRefs: CaseReference[] }
  | { ok: false; error: string; draftFallback?: string };

export async function generateDefense(opts: DefenseGenerateOpts): Promise<DefenseResult> {
  // 1. 选反点 (跨诉请 + 按诉请分别)
  const overallStrategies = selectStrategies(opts.analysis, 3);
  const claimStrategyMap = new Map<number, RebuttalStrategy>();
  for (const claim of opts.analysis.claims) {
    claimStrategyMap.set(claim.index, selectStrategyForClaim(claim, opts.analysis));
  }

  // 2. 收集所有类案参考 (去重)
  const caseRefsMap = new Map<string, CaseReference>();
  for (const s of [...overallStrategies, ...claimStrategyMap.values()]) {
    for (const ref of s.caseRefs) {
      if (!caseRefsMap.has(ref.title)) {
        caseRefsMap.set(ref.title, {
          title: ref.title,
          holding: ref.holding,
          applicableWhen: ref.applicableWhen,
        });
      }
    }
  }
  const caseRefs = Array.from(caseRefsMap.values());

  // 3. 拼装 Markdown 答辩状 (draft 模式纯模板)
  const baseContent = renderDefenseMarkdown(opts, overallStrategies, claimStrategyMap, caseRefs);

  if (opts.draft) {
    return {
      ok: true,
      content: baseContent,
      usedLLM: false,
      mode: 'draft',
      strategies: overallStrategies,
      caseRefs,
    };
  }

  // 4. AI 模式: 调 LLM 润色
  const llmResult = await callLLM(buildDefensePrompts(baseContent, opts, overallStrategies, caseRefs), {
    provider: opts.provider,
    temperature: 0.3,
    maxTokens: 6000,
  });

  if (!llmResult.ok) {
    return {
      ok: false,
      error: `LLM 润色失败 (${llmResult.code}): ${llmResult.error}\n已 fallback 到 draft 模式`,
      draftFallback: baseContent,
    };
  }

  return {
    ok: true,
    content: llmResult.text,
    usedLLM: true,
    mode: 'ai',
    strategies: overallStrategies,
    caseRefs,
  };
}

/**
 * 渲染答辩状 Markdown
 */
function renderDefenseMarkdown(
  opts: DefenseGenerateOpts,
  overallStrategies: RebuttalStrategy[],
  claimStrategyMap: Map<number, RebuttalStrategy>,
  caseRefs: CaseReference[],
): string {
  const { analysis, case: c } = opts;
  const today = new Date().toISOString().slice(0, 10);

  const sections: string[] = [];

  // === 标题与主体 ===
  sections.push(`# 民事答辩状

## 答辩人（即本案被告）

- **姓名/名称**：${c.plaintiff.name === c.defendant.name ? '__________' : c.defendant.name}
- **身份证号 / 统一社会信用代码**：${c.defendant.idNumber ?? '__________'}
- **住所地**：${c.defendant.address ?? '__________'}
- **联系电话**：${c.defendant.contact ?? '__________'}

## 被答辩人（即本案原告）

- **姓名/名称**：${analysis.parties.原告.name || c.plaintiff.name}

## 案由

**${analysis.cause}** 一案，答辩人就**${analysis.parties.原告.name || '原告'}**的起诉状及各项诉讼请求，现提出如下答辩意见。

---

`);

  // === 总体答辩策略 (开头先说总策略, 给法官一个全局观) ===
  sections.push(`## 总体答辩策略

本案的核心争议在于**${analysis.facts.tortMethod || '（待查明）'}**所发布的内容是否构成对${analysis.parties.原告.name}名誉权的侵害。答辩人认为，**原告的起诉缺乏事实和法律依据**，理由如下：

${overallStrategies.map((s, i) => `${i + 1}. **${s.name}**：${s.description}`).join('\n')}

以下逐条回应原告的诉讼请求。

---

`);

  // === 逐条诉请反驳 ===
  sections.push(`## 对各项诉讼请求的答辩

`);

  for (const claim of analysis.claims) {
    const strategy = claimStrategyMap.get(claim.index) ?? overallStrategies[0]!;
    sections.push(renderClaimRebuttal(claim, strategy));
    sections.push('\n---\n\n');
  }

  // === 事实与理由 (被告视角) ===
  sections.push(`## 事实与理由（答辩人视角）

### 一、原告起诉状事实摘要

${analysis.facts.tortMethod ? `原告主张 ${analysis.parties.被告.name} ${analysis.facts.tortMethod}。` : '（原告起诉状事实部分识别不完整, 以下为答辩人掌握的案件事实）'}
${analysis.facts.tortContent ? `原告指控的侵权内容为：${analysis.facts.tortContent.slice(0, 300)}${analysis.facts.tortContent.length > 300 ? '...' : ''}` : ''}
${analysis.facts.spread ? `原告主张的传播范围：${analysis.facts.spread}` : ''}

### 二、答辩人的事实主张

[待补充: 答辩人需要在此节陈述自身的客观事实, 包括:
1. 被告的真实身份/职业/与原告的关系
2. 涉案内容的真实来源/性质
3. 被告未实施被诉行为的事实依据
4. 即使存在部分用词, 也是基于合理事由

**重要**: 此节内容需要根据案件实际情况填写, 切勿虚构。]

---

`);

  // === 法律依据 ===
  const allLegalBasis = new Set<string>();
  for (const s of overallStrategies) {
    allLegalBasis.add(s.legalBasis);
  }
  allLegalBasis.add('《中华人民共和国民事诉讼法》第六十七条（谁主张谁举证）');

  sections.push(`## 法律依据

${Array.from(allLegalBasis).map((s, i) => `${i + 1}. ${s};`).join('\n')}

---

`);

  // === 类案参考 ===
  sections.push(renderCaseReferences(caseRefs));

  // === 证据清单指引 ===
  sections.push(renderEvidenceGuidance(overallStrategies));

  // === 落款 ===
  sections.push(`---

此致

**${c.court ?? '__________'}**

答辩人：${c.defendant.name}（签名/盖章）

${c.lawyer?.name ?? ''}

签发日期：${today}

---

## ⚠️ 重要提示

1. **本答辩状系基于起诉状拆解与反驳策略库自动生成的初稿**, 答辩人/律师必须:
   - 核对所有事实, 补充答辩人视角的客观陈述
   - 根据案件实际情况调整反点选择与措辞
   - 补充完整的证据清单 (在 "待补充" 处)
   - 由执业律师最终审核签字

2. **类案参考为裁判要点式总结, 非具体案号引用**, 实际引用类案需查阅:
   - 中国裁判文书网 (wenshu.court.gov.cn)
   - 北大法宝 / 威科先行 / 百度民法典

3. **本工具不构成律师法律意见**, 详见 docs/法律免责声明.md

---

**附**：
1. 本答辩状副本 ${analysis.parties.原告.name ? '1' : '__________'} 份（按原告人数提交）；
2. 答辩证据目录及全部证据材料 1 套；
3. 答辩人身份证明 1 份；
4. 授权委托书（如委托律师代理）1 份。
`);

  return sections.join('');
}

/**
 * 单条诉请的反驳段落
 */
function renderClaimRebuttal(claim: ParsedClaim, strategy: RebuttalStrategy): string {
  const amountStr = claim.amount ? `（${claim.amount.toLocaleString('zh-CN')} 元）` : '';
  return `### 诉请 ${claim.index}：${claim.content.slice(0, 50)}${claim.content.length > 50 ? '...' : ''}${amountStr}

**所选反点**：${strategy.name}（${strategy.legalBasis}）

${strategy.template.replace(/\[(.+?)\]/g, '**[$1]**')}
`;
}

/**
 * 类案参考渲染
 */
function renderCaseReferences(caseRefs: CaseReference[]): string {
  if (caseRefs.length === 0) return '';
  let s = `## 类案参考（裁判要点）

> **重要**: 以下为同类案件的**裁判要点**总结, **非具体案号引用**。实际诉讼中需查阅权威案例库确认具体裁判规则。

`;
  for (const ref of caseRefs) {
    s += `### ${ref.title}

- **裁判要点**：${ref.holding}
- **适用情形**：${ref.applicableWhen}

`;
  }
  s += '---\n\n';
  return s;
}

/**
 * 证据清单指引 — 告诉被告还需要补充哪些证据
 */
function renderEvidenceGuidance(strategies: RebuttalStrategy[]): string {
  const allEvidence = new Set<string>();
  for (const s of strategies) {
    for (const e of s.evidenceToGather) {
      allEvidence.add(e);
    }
  }
  if (allEvidence.size === 0) return '';
  let s = `## 答辩证据指引

> **基于本案反点, 建议补充以下证据**（按反点分组）:

`;
  for (const strategy of strategies) {
    s += `### ${strategy.name}

${strategy.evidenceToGather.map((e) => `- ${e}`).join('\n')}

`;
  }
  s += '---\n\n';
  return s;
}

/**
 * LLM 润色 prompts
 */
function buildDefensePrompts(
  draftText: string,
  opts: DefenseGenerateOpts,
  strategies: RebuttalStrategy[],
  caseRefs: CaseReference[],
): Array<{ role: 'system' | 'user'; content: string }> {
  const system = `你是一名中国民事诉讼律师, 专长名誉权纠纷案件的**被告应诉**工作。

你的任务是**基于以下拆解结果 + 反驳策略 + 模板初稿**, 生成一份专业、严谨、可直接用于诉讼的**民事答辩状**。

要求:
1. **严格基于事实**: 不得编造证据、不得编造事实, 不得添加任何未在初稿中出现的内容。
2. **法条引用准确**: 仅引用真实存在的法律条文, 不得编造条文编号。
3. **逐条反驳**: 必须对原告诉请**逐条回应**, 不得遗漏。
4. **类案参考保留**: 模板中的"类案参考"必须**完整保留** (这些是人工整理的裁判要点)。
5. **保留待补充标记**: 模板中的 "[待补充: ...]" 必须**完整保留**, 提示被告律师补充。
6. **保留证据指引**: 模板中的"答辩证据指引"必须**完整保留**, 这是 AI 的核心价值。
7. **语言风格**: 法言法语, 客观冷静, 句末用句号, 避免感叹号。
8. **格式保持**: 严格保留 Markdown 标题层级与表格。
9. **不要输出任何额外说明**, 直接输出完整的答辩状 Markdown。`;

  const user = `## 案件基本信息

${JSON.stringify({ case: opts.case, analysis: opts.analysis }, null, 2)}

## 所选反点 (按杀伤力排序)

${strategies.map((s, i) => `${i + 1}. ${s.name} — ${s.legalBasis}\n   ${s.description}`).join('\n')}

## 模板初稿 (Draft)

以下是基于案件事实 + 反点模板渲染的初稿, 请**润色、提升专业度、补充程序性内容**, 但**不得删除**任何"待补充"标记或"证据指引"或"类案参考":

\`\`\`markdown
${draftText}
\`\`\`

${opts.extraInstruction ? `**额外要求**: ${opts.extraInstruction}\n` : ''}
请直接输出润色后的完整答辩状 Markdown。`;

  return [
    { role: 'system', content: system },
    { role: 'user', content: user },
  ];
}

export { LLMResult };
