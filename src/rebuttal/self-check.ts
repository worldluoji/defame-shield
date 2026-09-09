/**
 * 抗辩自检器 (Defense Self-Checker)
 *
 * 目的: 模拟原告律师, 从原告视角攻击答辩状, 找出漏洞。
 *
 * 输入: 答辩状 markdown + 拆解结果
 * 输出: 漏洞列表 — 每个漏洞包含: 攻击方向 / 风险等级 / 原告可能论据 / 建议补丁
 *
 * 双模式:
 *   - ai:  LLM 驱动 (拟人化强, 但慢/贵)
 *   - rule: 规则引擎 (基于 8 个反点的"已知攻击向量", 快/可解释)
 */

import { callLLM } from '../llm/client.js';
import type { ComplaintAnalysis } from '../analyzer/complaint-types.js';
import type { RebuttalStrategy, StrategyId } from './strategies-base.js';
import { STRATEGIES, PROCEDURAL_IDS } from './strategies.js';

export type RiskLevel = 'critical' | 'high' | 'medium' | 'low';
export type CheckMode = 'ai' | 'rule' | 'hybrid';

export interface Vulnerability {
  id: string;
  /** 攻击方向 (原告律师角度的论据) */
  attack: string;
  /** 风险等级 */
  risk: RiskLevel;
  /** 涉及的反点 ID */
  strategyId: StrategyId;
  /** 涉及的原告诉请 index (可选) */
  claimIndex?: number;
  /** 原告可能的论据展开 */
  plaintiffArgument: string;
  /** 建议补丁 (被告应该补充什么) */
  suggestedFix: string;
  /** 涉及的具体法律条文 */
  legalBasis?: string;
}

export interface SelfCheckResult {
  ok: true;
  mode: CheckMode;
  /** 漏洞列表 (按风险等级倒序) */
  vulnerabilities: Vulnerability[];
  /** 整体评分 0-100, 越高表示答辩状越坚固 */
  overallScore: number;
  /** 摘要 */
  summary: string;
  /** 自检时间 */
  checkedAt: string;
}

export interface SelfCheckOptions {
  /** 答辩状 markdown 内容 */
  defense: string;
  /** 拆解结果 */
  analysis: ComplaintAnalysis;
  /** 模式: ai / rule / hybrid (默认 rule, 无需 API key) */
  mode?: CheckMode;
  /** LLM provider */
  provider?: 'deepseek' | 'minimax';
}

export async function selfCheckDefense(opts: SelfCheckOptions): Promise<SelfCheckResult> {
  const mode = opts.mode ?? 'rule';

  let ruleVulns: Vulnerability[] = [];
  let aiVulns: Vulnerability[] = [];

  // 1. 规则引擎 (基础)
  ruleVulns = ruleBasedCheck(opts.defense, opts.analysis);

  // 2. AI 模式 (可选)
  if (mode === 'ai' || mode === 'hybrid') {
    const aiResult = await aiBasedCheck(opts.defense, opts.analysis, opts.provider);
    if (aiResult) {
      aiVulns = aiResult;
    }
  }

  // 3. 合并去重
  const merged = mode === 'rule' ? ruleVulns : mergeAndDedup(ruleVulns, aiVulns);

  // 4. 评分
  const overallScore = computeOverallScore(merged);

  return {
    ok: true,
    mode,
    vulnerabilities: merged.sort(byRisk),
    overallScore,
    summary: makeSummary(merged, overallScore),
    checkedAt: new Date().toISOString(),
  };
}

/**
 * 修补建议自动注入 — 根据漏洞列表生成可粘贴的修补段落
 *
 * 三种注入策略:
 *   1. 程序性反点 (missing-statute-limitations / -jurisdiction / -wrong-party):
 *      → 在答辩状开头插入"程序性抗辩"段 (含模板+占位符)
 *   2. 实体反点 (no-tort-grade / no-damage / fact-true 等):
 *      → 在每条诉请前补一段反点模板
 *   3. 占位符未填 (unfilled-placeholders):
 *      → 列出所有占位符, 引导人工填
 *   4. 诉请未回应 (claim-X-no-response):
 *      → 在该诉请位置插入模板
 *   5. 证据指引缺失 / 类案参考缺失:
 *      → 提示"建议在文末补充" (不直接插入, 避免过长)
 */
export interface ApplyFixesResult {
  ok: true;
  /** 修补后的答辩状 (含所有注入内容) */
  patched: string;
  /** 注入的修补段落数 */
  injectedCount: number;
  /** 修补摘要 */
  summary: string;
}

export function applyFixes(
  defense: string,
  vulns: Vulnerability[],
  analysis: ComplaintAnalysis,
  caseContext: { caseName: string; defendantName: string },
): ApplyFixesResult {
  let patched = defense;
  let injected = 0;
  const notes: string[] = [];

  for (const v of vulns) {
    if (v.risk === 'low') continue; // 低风险不注入

    if (v.id === 'missing-statute-limitations' ||
        v.id === 'missing-jurisdiction' ||
        v.id === 'missing-wrong-party') {
      // 注入程序性抗辩段 (strategyId 可能来自 AI 输出, 不可信)
      const strategy = STRATEGIES[v.strategyId];
      if (!strategy) {
        notes.push(`跳过未知策略 ID: ${String(v.strategyId)}`);
        continue;
      }
      const section = renderProceduralDefense(strategy, caseContext);
      patched = injectAfter(patched, '## 总体答辩策略', section);
      injected++;
      notes.push(`注入程序性反点: ${strategy.name}`);
    } else if (v.id.startsWith('unfilled-placeholders')) {
      // 注入"待补充占位符清单"段
      const section = renderPlaceholderNotice(v);
      patched = injectAfter(patched, '## ⚠️ 重要提示', section, true);
      injected++;
      notes.push(`注入占位符提醒: ${v.attack.slice(0, 50)}`);
    } else if (v.id.startsWith('claim-') && v.id.endsWith('-no-response')) {
      // 注入单条诉请反驳
      const claimIndex = v.claimIndex;
      if (claimIndex) {
        const section = renderClaimResponse(claimIndex, v, analysis);
        patched = injectAfter(patched, `### 诉请 ${claimIndex}：`, section);
        injected++;
        notes.push(`注入诉请 ${claimIndex} 反驳`);
      }
    } else if (v.id === 'no-evidence-guidance' || v.id === 'no-case-references') {
      // 提示性提醒, 不直接注入
      notes.push(`[提示] ${v.attack}: ${v.suggestedFix}`);
    } else if (v.id === 'fact-true-no-verification' || v.id === 'no-damage-weak-against-strong') {
      // 注入强化证据指引
      const section = renderEvidenceReinforcement(v);
      patched = injectAfter(patched, '## 答辩证据指引', section, true);
      injected++;
      notes.push(`强化证据指引: ${v.id}`);
    }
  }

  return {
    ok: true,
    patched,
    injectedCount: injected,
    summary: notes.length > 0 ? notes.join('\n') : '无需修补',
  };
}

function injectAfter(text: string, anchor: string, section: string, before = false): string {
  const idx = text.indexOf(anchor);
  if (idx < 0) {
    // 锚点不存在, 追加到末尾
    return text + '\n\n' + section;
  }
  if (before) {
    return text.slice(0, idx) + section + '\n\n' + text.slice(idx);
  }
  // 找到锚点所在行的末尾
  const lineEnd = text.indexOf('\n', idx);
  if (lineEnd < 0) return text + '\n\n' + section;
  return text.slice(0, lineEnd + 1) + section + '\n\n' + text.slice(lineEnd + 1);
}

function renderProceduralDefense(strategy: RebuttalStrategy, ctx: { caseName: string; defendantName: string }): string {
  // 模板变量 (侵权时间/法院/地址等) 案件事实未知, 按文书惯例留横线
  const body = strategy.template.replace(/\{(tortTime|filingTime|elapsed|defendantAddress|court|platform)\}/g, '__________');
  return `### ${strategy.name}（程序性抗辩）

> **由抗辩自检器自动注入** — 本节为程序性反点, 优先于实体反点.

${body}

**适用说明**: 本节为程序性抗辩, 一旦成立可**直接驳回**原告全部诉请. ${ctx.defendantName} 在此明确提出${strategy.name}, 提请受案法院依法审查.
`;
}

function renderPlaceholderNotice(v: Vulnerability): string {
  return `### 📌 待补充占位符清单

> **由抗辩自检器自动注入** — 答辩状含未填的 [xxx] 占位符, 必须人工补充.

${v.suggestedFix}

**快速定位**: 在答辩状编辑器中搜索 \`[\` 即可找到所有占位符.
`;
}

function renderClaimResponse(claimIndex: number, v: Vulnerability, analysis: ComplaintAnalysis): string {
  const claim = analysis.claims.find((c) => c.index === claimIndex);
  if (!claim) return '';
  return `#### 补充反驳 (诉请 ${claimIndex}: ${claim.content.slice(0, 40)}...)

> **由抗辩自检器自动注入** — 此项诉请在初稿中未做实质性回应.

${v.suggestedFix}

**理由**: ${v.plaintiffArgument}
`;
}

function renderEvidenceReinforcement(v: Vulnerability): string {
  return `### 🔧 强化证据指引 (${v.id})

> **由抗辩自检器自动注入**

**问题**: ${v.attack}

**建议补充证据**:
${v.suggestedFix}

**法条**: ${v.legalBasis ?? ''}
`;
}

/**
 * 规则引擎自检
 * 基于 8 个反点的"已知攻击向量", 找出答辩状的漏洞
 */
function ruleBasedCheck(defense: string, analysis: ComplaintAnalysis): Vulnerability[] {
  const vulns: Vulnerability[] = [];
  const usedStrategies = detectUsedStrategies(defense);

  // === 通用检查 ===
  // 1. 答辩状是否过短 (说明事实部分没写)
  if (defense.length < 1500) {
    vulns.push({
      id: 'too-short',
      attack: '答辩状过短, 事实部分含糊, 容易被法官认为举证不充分',
      risk: 'high',
      strategyId: 'no-act',
      plaintiffArgument: '原告律师: "被告的答辩状仅 1 页, 对原告提交的多份证据未做具体回应, 显然属于消极答辩, 法庭应按原告证据认定事实。"',
      suggestedFix: '补充 [事实与理由 - 答辩人视角] 章节, 对原告的每条证据逐一回应',
    });
  }

  // 2. 是否还含 [待补充] 占位符
  const placeholders = (defense.match(/\[待补充[^\]]*\]|\[[^\]\n]{1,30}\]/g) ?? []).filter(
    (p) => !p.includes('**') || p.includes('待补充'),
  );
  if (placeholders.length > 0) {
    vulns.push({
      id: 'unfilled-placeholders',
      attack: `答辩状含 ${placeholders.length} 处未填占位符 (如 ${placeholders.slice(0, 3).join(', ')}), 律师未补充案件特有事实`,
      risk: 'critical',
      strategyId: 'no-act',
      plaintiffArgument: `原告律师: "被告的答辩状大量使用 [xxx] 形式的占位符, 明显是 AI 生成的模板, 缺乏针对本案的实质性抗辩意见, 法庭不应采信。"`,
      suggestedFix: `逐一填充所有 [待补充] 占位符, 写入本案特有事实 (如信息来源、核实经过、损害与被告行为无关的证据等)`,
    });
  }

  // 3. 4 要件评分检查
  if (analysis.elementScore.factAuthenticity === 'likely_true' && usedStrategies.includes('fact-true')) {
    // 用了 fact-true 但事实 likely_true, OK; 但需要核实义务证据
    if (!/核实|核验|查证|采访|调查|证据链/.test(defense)) {
      vulns.push({
        id: 'fact-true-no-verification',
        attack: '选择"事实基本属实"反点但未充分举证核实义务',
        risk: 'high',
        strategyId: 'fact-true',
        plaintiffArgument: '原告律师: "被告主张事实基本属实并以舆论监督免责, 但被告未能证明其已尽到合理核实义务, 依据民法典 1025 条第二项, 不应免责。"',
        suggestedFix: '在 fact-true 反点段落后, 补充: 1) 信息来源 (政府文件/公开判决/权威报道); 2) 核实过程 (采访记录/邮件/电话录音); 3) 权威第三方对事实的认定',
        legalBasis: '《中华人民共和国民法典》第一千零二十五条第二项',
      });
    }
  }

  if (analysis.elementScore.damage === 'strong' && usedStrategies.includes('no-damage')) {
    vulns.push({
      id: 'no-damage-weak-against-strong',
      attack: '选择"无损害后果"反点但原告已充分举证损害',
      risk: 'critical',
      strategyId: 'no-damage',
      plaintiffArgument: '原告律师: "原告已提交医院诊断证明、劳动合同解除通知、收入减少的银行流水等, 损害事实清楚。被告仅以"未能举证"否认, 但原告举证已充分, 法庭应认定损害存在。"',
      suggestedFix: '改用"无因果关系"反点, 强调损害系原告自身原因 (既往负面评价) 或第三人行为所致, 而非被告内容导致',
      legalBasis: '《中华人民共和国民法典》第一千零二十四条',
    });
  }

  // 4. 程序性反点检查
  for (const id of PROCEDURAL_IDS) {
    const strategy = STRATEGIES[id];
    const score = strategy.applicability(analysis);
    if (score >= 0.7 && !usedStrategies.includes(id)) {
      vulns.push({
        id: `missing-${id}`,
        attack: `反点 "${strategy.name}" 高度适用 (适用度 ${(score * 100).toFixed(0)}%), 答辩状未采用`,
        risk: 'critical',
        strategyId: id,
        plaintiffArgument: `原告律师: "被告未就 [诉讼时效/管辖/被告主体] 提出抗辩, 视为放弃相应抗辩权。法庭应直接审查实体争议。"`,
        suggestedFix: `在答辩状中显式采纳 "${strategy.name}" 反点. ${strategy.description}`,
        legalBasis: strategy.legalBasis,
      });
    }
  }

  // 5. 诉请匹配检查 — 诉请越多, 越要逐条回应
  for (const claim of analysis.claims) {
    if (claim.content.length > 30 && !defense.includes(`诉请 ${claim.index}：`)) {
      vulns.push({
        id: `claim-${claim.index}-no-response`,
        attack: `诉请 ${claim.index} (${claim.content.slice(0, 20)}...) 在答辩状中未明确回应`,
        risk: 'high',
        strategyId: 'no-damage',
        claimIndex: claim.index,
        plaintiffArgument: `原告律师: "被告对诉请 ${claim.index} 未作实质性回应, 视为放弃抗辩, 法庭应支持该项请求。"`,
        suggestedFix: `为诉请 ${claim.index} 添加完整反驳段落, 明确 [所选反点] + [具体理由] + [证据指引]`,
      });
    }
  }

  // 6. 证据指引检查
  if (!/证据清单|证据指引|补充.*证据/.test(defense)) {
    vulns.push({
      id: 'no-evidence-guidance',
      attack: '答辩状未列出需要补充的证据清单, 律师可能遗漏关键证据',
      risk: 'medium',
      strategyId: 'no-damage',
      plaintiffArgument: '原告律师: "被告仅作笼统抗辩, 未提交任何支持其抗辩意见的证据, 法庭应认定被告抗辩缺乏证据支持。"',
      suggestedFix: '在答辩状末尾添加 [答辩证据清单] 章节, 列出支持每个反点的具体证据 (如: 公证书、平台注册信息、信息来源原始材料等)',
    });
  }

  // 7. 类案参考检查
  if (!/类案参考|裁判要点|指导案例/.test(defense)) {
    vulns.push({
      id: 'no-case-references',
      attack: '答辩状未引用任何类案, 缺乏对同类案件裁判规则的说服力',
      risk: 'low',
      strategyId: 'no-damage',
      plaintiffArgument: '原告律师: "被告未引用任何类案支持其抗辩意见, 法庭在无类案指引的情况下应严格按法条文义裁判。"',
      suggestedFix: '在 [类案参考] 章节增加 3-5 条同类案件裁判要点 (从本工具的策略库或裁判文书网查找)',
    });
  }

  // 8. 法律依据引用检查
  const citedLaws = countLegalBasis(defense);
  if (citedLaws < 3) {
    vulns.push({
      id: 'few-legal-basis',
      attack: `答辩状仅引用 ${citedLaws} 条法律, 可能被法官认为论证不充分`,
      risk: 'medium',
      strategyId: 'no-damage',
      plaintiffArgument: `原告律师: "被告答辩状仅引用 ${citedLaws} 条法律, 对原告依据的民法典 1024、1025、1183 等核心条文未做实质性反驳, 法庭应按原告法律意见裁判。"`,
      suggestedFix: '对原告引用的每条法条逐一回应, 区分"同意" / "反对" / "另有解释"',
    });
  }

  return vulns;
}

/**
 * AI 模式自检 — 模拟原告律师
 */
async function aiBasedCheck(
  defense: string,
  analysis: ComplaintAnalysis,
  provider?: 'deepseek' | 'minimax',
): Promise<Vulnerability[] | null> {
  const system = `你是一名资深民事诉讼律师, **代理原告**, 任务是攻击用户提供的"被告答辩状", 找出其**逻辑漏洞、证据缺口、事实矛盾、程序瑕疵**。

输出格式: 严格 JSON 数组, 每条包含:
- id: 唯一标识
- attack: 攻击点 (一句话)
- risk: critical / high / medium / low
- strategyId: 对应的反点 ID
- claimIndex: 涉及的原告诉请 index (可选)
- plaintiffArgument: 你的论据展开 (100-200 字)
- suggestedFix: 建议被告如何修补
- legalBasis: 相关法条 (可选)

**只输出 JSON 数组, 不要任何额外说明**。`;

  const user = `## 原告起诉状拆解结果

${JSON.stringify(analysis, null, 2)}

## 被告答辩状

\`\`\`markdown
${defense}
\`\`\`

请从原告律师视角, 找出答辩状的 5-10 个最致命漏洞。`;

  const result = await callLLM(
    [
      { role: 'system', content: system },
      { role: 'user', content: user },
    ],
    { provider, temperature: 0.5, maxTokens: 4000 },
  );

  if (!result.ok) return null;

  // 解析 JSON
  const arr = extractJsonArray(result.text);
  if (!arr) return null;

  return arr.map((item, i) => normalizeVulnerability(item, i));
}

function normalizeVulnerability(item: unknown, i: number): Vulnerability {
  const o = (item ?? {}) as Record<string, unknown>;
  return {
    id: String(o['id'] ?? `ai-vuln-${i}`),
    attack: String(o['attack'] ?? ''),
    risk: (o['risk'] as RiskLevel) ?? 'medium',
    strategyId: (o['strategyId'] as StrategyId) ?? 'no-damage',
    claimIndex: typeof o['claimIndex'] === 'number' ? o['claimIndex'] : undefined,
    plaintiffArgument: String(o['plaintiffArgument'] ?? ''),
    suggestedFix: String(o['suggestedFix'] ?? ''),
    legalBasis: o['legalBasis'] ? String(o['legalBasis']) : undefined,
  };
}

function extractJsonArray(text: string): unknown[] | null {
  // 兼容 ```json``` 包裹
  const m = text.match(/```(?:json)?\s*\n?([\s\S]+?)\n?```/);
  const jsonText = m && m[1] ? m[1] : text;
  const first = jsonText.indexOf('[');
  const last = jsonText.lastIndexOf(']');
  if (first < 0 || last < 0) return null;
  try {
    return JSON.parse(jsonText.slice(first, last + 1));
  } catch {
    return null;
  }
}

function mergeAndDedup(ruleVulns: Vulnerability[], aiVulns: Vulnerability[]): Vulnerability[] {
  // 按 attack 文本相似度去重, AI 优先 (描述更详细)
  const seen = new Set<string>();
  const result: Vulnerability[] = [];
  for (const v of [...aiVulns, ...ruleVulns]) {
    const key = normalizeKey(v.attack);
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(v);
  }
  return result;
}

function normalizeKey(s: string): string {
  return s.replace(/[^\u4e00-\u9fa5a-zA-Z]/g, '').slice(0, 30);
}

function detectUsedStrategies(defense: string): StrategyId[] {
  const result: StrategyId[] = [];
  const all: StrategyId[] = [
    'fact-true', 'no-act', 'no-tort-grade', 'no-damage', 'no-causation',
    'statute-limitations', 'jurisdiction', 'wrong-party',
  ];
  for (const id of all) {
    const s = STRATEGIES[id];
    if (defense.includes(s.name)) {
      result.push(id);
    }
  }
  return result;
}

function countLegalBasis(defense: string): number {
  // 粗略数 "第xxx条" 出现次数
  return (defense.match(/第[零一二三四五六七八九十百千\d]+条/g) ?? []).length;
}

function computeOverallScore(vulns: Vulnerability[]): number {
  let score = 100;
  for (const v of vulns) {
    const deduction = v.risk === 'critical' ? 20 : v.risk === 'high' ? 10 : v.risk === 'medium' ? 5 : 2;
    score -= deduction;
  }
  return Math.max(0, score);
}

function byRisk(a: Vulnerability, b: Vulnerability): number {
  const order: Record<RiskLevel, number> = { critical: 0, high: 1, medium: 2, low: 3 };
  return order[a.risk] - order[b.risk];
}

function makeSummary(vulns: Vulnerability[], score: number): string {
  const counts: Record<RiskLevel, number> = { critical: 0, high: 0, medium: 0, low: 0 };
  for (const v of vulns) counts[v.risk]++;
  if (score >= 85) return `答辩状较为坚固 (${score} 分), 仅有少量低风险漏洞`;
  if (score >= 70) return `答辩状有若干需要修补的中等风险漏洞 (${score} 分)`;
  if (score >= 50) return `答辩状存在较多高风险漏洞 (${score} 分), 建议优先修补 critical/high 项`;
  return `答辩状存在致命漏洞 (${score} 分), 强烈建议重新审视整体策略`;
}
