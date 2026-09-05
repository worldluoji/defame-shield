/**
 * 起诉状拆解器 — 把 markdown 起诉状文本拆成 4 维结构化 JSON
 *
 * 双模式:
 *   - ai:  LLM 驱动, 输出更准
 *   - draft: 纯关键词/正则抽取, 不调 LLM, 准确性差
 *
 * 输入: 起诉状 markdown 文本 (string) 或文件路径
 * 输出: ComplaintAnalysis JSON
 */

import { readFileSync, existsSync } from 'node:fs';
import { callLLM, type LLMResult } from '../llm/client.js';
import type {
  ComplaintAnalysis,
  AnalyzeOptions,
  AnalyzeResult,
  ParsedClaim,
  ParsedEvidence,
  ParsedParty,
  ParsedFacts,
  ElementScore,
  CaseReference,
} from './complaint-types.js';

const ANALYZER_SYSTEM_PROMPT = `你是一名中国民事诉讼律师，专长名誉权纠纷案件的**被告应诉**工作。

你的任务是**逐字逐句拆解**用户提供的原告起诉状（Markdown 格式），输出 4 维结构化 JSON，用于指导被告撰写答辩状。

## 拆解维度

### 1. 主体 (parties)
提取原告、被告、律师/代理人的姓名/名称、身份证号、地址、联系方式。**逐字照抄起诉状中的字段**，不得推断。

### 2. 诉请 (claims)
按起诉状中的"诉讼请求"小节，按编号拆分每一条诉请：
- index: 1, 2, 3 ...
- content: 诉请原文（精简到 50 字以内）
- type: 分类为以下之一
  - stop_infringement       停止侵害/删除
  - restore_reputation      恢复名誉/消除影响/赔礼道歉
  - compensate_loss         赔偿损失/合理费用
  - spiritual_compensation  精神损害抚慰金
  - litigation_cost         诉讼费/公告费
  - other                   其他
- amount: 金额（元），仅适用于赔偿类

### 3. 事实 (facts)
从"事实与理由"小节提取：
- tortMethod: 侵权方式（微博/抖音/朋友圈/文章/口头/其他）
- tortContent: 侵权内容原文或概括（500 字以内）
- spread: 传播范围（粉丝数/浏览量/转发量等）
- time: 侵权时间
- place: 侵权地点/平台

### 4. 证据 (evidence)
按编号提取每条证据的：名称、种类、证明目的。

### 5. 法律依据 (legalBasis)
原告引用的所有法条编号（如"民法典第 1024 条""民法典第 1183 条"等），逐条列出。

## 4 要件评分 (elementScore) — 关键

为每条诉请的成立可能性评估：

- factAuthenticity: 事实真实性
  - likely_true  大概率属实
  - disputed     存在争议
  - likely_false 大概率不实
  - unknown      信息不足

- directedness: 内容指向性（能否识别原告）
  - high   内容直接指名道姓或具明显可识别特征
  - medium 含部分可识别信息
  - low    抽象/泛指/未提及原告

- fault: 主观过错
  - intentional  故意
  - negligent    过失
  - unknown      无法判断

- damage: 损害后果充分性
  - strong        充分举证
  - weak          举证较弱
  - none_proven   未举证

## 反驳优先级 (rebuttalPriority)
按"被告最容易打掉"到"最难打掉"对诉请排序，输出 index 列表。

## 整体置信度 (confidence)
0-1 数值，根据起诉状完整性/清晰度自评。0.3-0.5 表示部分信息缺失，0.8+ 表示起诉状完整清晰。

## 警告 (warnings)
列出拆解过程中发现的问题，例如"原告诉请 2 金额未填写""证据 3 证明目的不明确"等。

## 类案参考 (caseReferences) — 留空数组即可，下一步填入

## 输出格式
**严格输出 JSON**，不要任何解释文字、Markdown 包装、注释。**只输出 JSON 对象本身**。`;

/**
 * 拆解入口 — 接受文件路径或直接文本
 */
export async function analyzeComplaint(
  input: string,
  opts: AnalyzeOptions = {},
): Promise<AnalyzeResult> {
  // 1. 读文件 (如果传的是路径)
  let text: string;
  if (existsSync(input) && input.endsWith('.md')) {
    text = readFileSync(input, 'utf-8');
  } else {
    text = input;
  }

  if (!text || text.trim().length < 50) {
    return {
      ok: false,
      error: '起诉状文本过短 (< 50 字), 请提供完整起诉状内容',
      code: 'parse_error',
    };
  }

  // 2. draft 模式: 纯正则抽取
  if (opts.draft) {
    return {
      ok: true,
      analysis: extractByKeywords(text, input),
    };
  }

  // 3. AI 模式: 调 LLM
  const llmResult = await callLLM(
    [
      { role: 'system', content: ANALYZER_SYSTEM_PROMPT },
      {
        role: 'user',
        content: `## 原告起诉状 (Markdown)\n\n${text}\n\n请输出 JSON。`,
      },
    ],
    {
      provider: opts.provider,
      temperature: 0.2, // 低温度, 偏确定性
      maxTokens: 4000,
    },
  );

  if (!llmResult.ok) {
    // fallback 到 draft
    const draftAnalysis = extractByKeywords(text, input);
    return {
      ok: false,
      error: `LLM 拆解失败 (${llmResult.code}): ${llmResult.error}\n已 fallback 到 draft 模式`,
      code: 'llm_error',
      partialDraft: draftAnalysis,
    };
  }

  // 4. 解析 LLM 输出的 JSON
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

/**
 * 解析 LLM 返回的 JSON (兼容 markdown 包裹 / 前缀文字)
 */
function parseAndValidateLLMJson(
  raw: string,
  source: string,
): { ok: true; analysis: ComplaintAnalysis } | { ok: false; error: string } {
  // 尝试从 ```json ... ``` 块中提取
  let jsonText = raw.trim();
  const codeBlock = raw.match(/```(?:json)?\s*\n?([\s\S]+?)\n?```/);
  if (codeBlock && codeBlock[1]) {
    jsonText = codeBlock[1].trim();
  } else {
    // 尝试找第一个 { 到最后一个 }
    const first = raw.indexOf('{');
    const last = raw.lastIndexOf('}');
    if (first >= 0 && last > first) {
      jsonText = raw.slice(first, last + 1);
    }
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonText);
  } catch (e) {
    return { ok: false, error: `JSON.parse 失败: ${(e as Error).message}` };
  }

  // 基础字段校验
  if (!parsed || typeof parsed !== 'object') {
    return { ok: false, error: 'LLM 输出非对象' };
  }
  const obj = parsed as Record<string, unknown>;
  if (!obj.parties || !obj.claims || !obj.facts) {
    return { ok: false, error: 'LLM 输出缺少关键字段 (parties/claims/facts)' };
  }

  // 标准化 + 兜底字段
  const analysis: ComplaintAnalysis = {
    source,
    analyzedAt: new Date().toISOString(),
    mode: 'ai',
    parties: normalizeParties(obj.parties as Record<string, unknown>),
    cause: String(obj.cause ?? ''),
    claims: normalizeClaims(obj.claims as unknown[]),
    facts: normalizeFacts(obj.facts as Record<string, unknown>),
    evidence: normalizeEvidence(obj.evidence as unknown[] | undefined),
    legalBasis: Array.isArray(obj.legalBasis) ? obj.legalBasis.map(String) : [],
    elementScore: normalizeElementScore(obj.elementScore as Record<string, unknown> | undefined),
    rebuttalPriority: normalizePriority(obj.rebuttalPriority as unknown[] | undefined, obj.claims as unknown[]),
    confidence: typeof obj.confidence === 'number' ? Math.max(0, Math.min(1, obj.confidence)) : 0.5,
    warnings: Array.isArray(obj.warnings) ? obj.warnings.map(String) : [],
    caseReferences: Array.isArray(obj.caseReferences)
      ? (obj.caseReferences as CaseReference[])
      : undefined,
  };

  return { ok: true, analysis };
}

function normalizeParties(p: Record<string, unknown>): ComplaintAnalysis['parties'] {
  const obj: ComplaintAnalysis['parties'] = {
    原告: normalizeParty((p['原告'] as Record<string, unknown>) ?? p['plaintiff']),
    被告: normalizeParty((p['被告'] as Record<string, unknown>) ?? p['defendant']),
  };
  if (p['律师'] || p['lawyer']) {
    obj.律师 = normalizeParty((p['律师'] as Record<string, unknown>) ?? (p['lawyer'] as Record<string, unknown>));
  }
  return obj;
}

function normalizeParty(p: Record<string, unknown> | undefined): ParsedParty {
  if (!p) return { name: '', role: '原告' };
  return {
    name: String(p['name'] ?? p['姓名'] ?? ''),
    role: (p['role'] as ParsedParty['role']) ?? '原告',
    idNumber: p['idNumber'] || p['身份证号'] ? String(p['idNumber'] ?? p['身份证号']) : undefined,
    address: p['address'] || p['地址'] ? String(p['address'] ?? p['地址']) : undefined,
    contact: p['contact'] || p['联系方式'] ? String(p['contact'] ?? p['联系方式']) : undefined,
  };
}

function normalizeClaims(arr: unknown[]): ParsedClaim[] {
  if (!Array.isArray(arr)) return [];
  return arr
    .map((item, i) => {
      if (!item || typeof item !== 'object') return null;
      const o = item as Record<string, unknown>;
      return {
        index: typeof o['index'] === 'number' ? o['index'] : i + 1,
        content: String(o['content'] ?? o['诉请'] ?? ''),
        type: (o['type'] as ParsedClaim['type']) ?? 'other',
        amount: typeof o['amount'] === 'number' ? o['amount'] : undefined,
      } as ParsedClaim;
    })
    .filter((x): x is ParsedClaim => x !== null);
}

function normalizeFacts(f: Record<string, unknown>): ParsedFacts {
  return {
    tortMethod: String(f['tortMethod'] ?? f['侵权方式'] ?? ''),
    tortContent: String(f['tortContent'] ?? f['侵权内容'] ?? ''),
    spread: String(f['spread'] ?? f['传播范围'] ?? ''),
    time: f['time'] || f['时间'] ? String(f['time'] ?? f['时间']) : undefined,
    place: f['place'] || f['地点'] || f['平台'] ? String(f['place'] ?? f['地点'] ?? f['平台']) : undefined,
  };
}

function normalizeEvidence(arr: unknown[] | undefined): ParsedEvidence[] {
  if (!Array.isArray(arr)) return [];
  return arr
    .map((item, i) => {
      if (!item || typeof item !== 'object') return null;
      const o = item as Record<string, unknown>;
      return {
        index: typeof o['index'] === 'number' ? o['index'] : i + 1,
        name: String(o['name'] ?? o['名称'] ?? ''),
        kind: String(o['kind'] ?? o['种类'] ?? ''),
        purpose: String(o['purpose'] ?? o['证明目的'] ?? ''),
      } as ParsedEvidence;
    })
    .filter((x): x is ParsedEvidence => x !== null);
}

function normalizeElementScore(s: Record<string, unknown> | undefined): ElementScore {
  if (!s) {
    return { factAuthenticity: 'unknown', directedness: 'medium', fault: 'unknown', damage: 'weak' };
  }
  return {
    factAuthenticity: (s['factAuthenticity'] as ElementScore['factAuthenticity']) ?? 'unknown',
    directedness: (s['directedness'] as ElementScore['directedness']) ?? 'medium',
    fault: (s['fault'] as ElementScore['fault']) ?? 'unknown',
    damage: (s['damage'] as ElementScore['damage']) ?? 'weak',
  };
}

function normalizePriority(arr: unknown[] | undefined, claims: unknown[]): number[] {
  if (!Array.isArray(arr) || arr.length === 0) {
    return (Array.isArray(claims) ? claims : []).map((_, i) => i + 1);
  }
  return arr.map((n) => Number(n)).filter((n) => Number.isFinite(n));
}

/**
 * 关键词抽取 — 不调 LLM, 粗糙但可用
 */
function extractByKeywords(text: string, source: string): ComplaintAnalysis {
  const warnings: string[] = [];

  // 姓名抽取
  const plaintiffName = extractName(text, '原告') || extractName(text, '原告[:：]?\\s*([^\\n]+)');
  const defendantName = extractName(text, '被告') || extractName(text, '被告[:：]?\\s*([^\\n]+)');

  // 诉请抽取
  const claims = extractClaims(text);
  if (claims.length === 0) warnings.push('未能识别诉请, 请人工检查');

  // 事实抽取
  const facts = extractFacts(text);

  // 证据抽取
  const evidence = extractEvidence(text);

  // 法条抽取
  const legalBasis = extractLegalBasis(text);

  // 元素评分 (粗略)
  const elementScore = estimateElementScore(text, facts);

  // 反驳优先级
  const rebuttalPriority = claims.map((c) => c.index);

  return {
    source,
    analyzedAt: new Date().toISOString(),
    mode: 'draft',
    parties: {
      原告: { name: plaintiffName, role: '原告' },
      被告: { name: defendantName, role: '被告' },
    },
    cause: '网络侵权名誉权',
    claims,
    facts,
    evidence,
    legalBasis,
    elementScore,
    rebuttalPriority,
    confidence: 0.3,
    warnings,
  };
}

function extractName(text: string, role: string): string {
  // 优先匹配 Markdown "## 原告" 标题块
  const sectionRe = new RegExp(`##\\s*${role}[\\s\\S]{0,300}`, 'm');
  const section = text.match(sectionRe)?.[0] ?? '';
  if (section) {
    // 跳过 markdown 强调 ** **, 然后匹配 "姓名: 张三" / "姓名/名称：张三" / "名称 张三"
    const m = section.match(/(?:姓名|名称)[/\\s]*\*?\*?\s*[:：]\s*\*?\*?([^\n*，,\s]{2,8})/)?.[1];
    if (m && m !== '姓名' && m !== '名称') return m.trim();
  }
  // 兜底: "原告张三" "被告李四"
  const inlineM = text.match(new RegExp(`${role}([^\\s\\n,，:：*]{2,8})`, 'm'))?.[1];
  return inlineM && inlineM !== '姓名' && inlineM !== '名称' ? inlineM.trim() : '';
}

function extractClaims(text: string): ParsedClaim[] {
  // 抽取 "诉讼请求" 段
  const sectionMatch = text.match(/诉讼请求[\s\S]*?(?=事实与理由|此致|附[\s\S]*?:|$)/);
  if (!sectionMatch) return [];
  const section = sectionMatch[0];
  const items: ParsedClaim[] = [];
  // 逐行扫: 匹配 "数字. xxx" 或 "（数字）xxx" 开头
  const re = /^[ \t]*[（(]?(\d+)[）)]?[、.．\s]+(.+?)$/gm;
  let match: RegExpExecArray | null;
  while ((match = re.exec(section)) !== null) {
    const content = match[2]?.replace(/\s+/g, ' ').trim();
    if (content && content.length > 5) {
      items.push({
        index: parseInt(match[1]!, 10),
        content: content.slice(0, 200),
        type: classifyClaim(content),
        amount: extractAmount(content),
      });
    }
  }
  return items;
}

function classifyClaim(content: string): ParsedClaim['type'] {
  if (/(停止侵害|删除|屏蔽|断开链接)/.test(content)) return 'stop_infringement';
  if (/(赔礼道歉|消除影响|恢复名誉|公开致歉)/.test(content)) return 'restore_reputation';
  if (/(精神损害|抚慰金)/.test(content)) return 'spiritual_compensation';
  if (/(合理费用|律师费|公证费|差旅费|误工费|赔偿.*?元)/.test(content)) return 'compensate_loss';
  if (/(诉讼费|公告费)/.test(content)) return 'litigation_cost';
  return 'other';
}

function extractAmount(content: string): number | undefined {
  const m = content.match(/(\d[\d,，]*)\s*元/);
  if (!m || !m[1]) return undefined;
  return parseInt(m[1].replace(/[,，]/g, ''), 10);
}

function extractFacts(text: string): ParsedFacts {
  const sectionMatch = text.match(/(?:^|\n)#{1,3}\s*事实与理由\s*\n+([\s\S]*?)(?=\n#{1,3}|此致|附[\s\S]*?:|法律依据|$)/);
  const section = sectionMatch && sectionMatch[1] ? sectionMatch[1].trim() : text;

  const tortMethod =
    section.match(/(?:通过|利用)([^，,。;；\n]{2,30}?)(?:发布|传播|发帖|撰文)/)?.[1]?.trim() ??
    section.match(/(微博|抖音|微信|朋友圈|公众号|网站|论坛|报纸|杂志|电视|电台|短视频)/)?.[1] ??
    '（未识别）';

  const tortContent =
    section.match(/(?:内容为|所述为|表述为|写道|声称)[:：]?[""「」]?([\s\S]{20,500}?)[""」]?(?:[。！？\n]|$)/)?.[1]?.trim() ??
    section.slice(0, 300);

  const spread =
    section.match(/(粉丝\s*[\d,，]+|浏览\s*[\d,，]+|阅读\s*[\d,，]+|转发\s*[\d,，]+|播放\s*[\d,，]+)/)?.[0] ??
    '';

  return {
    tortMethod,
    tortContent: tortContent.slice(0, 500),
    spread,
  };
}

function extractEvidence(text: string): ParsedEvidence[] {
  // 只在"证据"段抽取 (起诉状末尾的"证据清单"小节)
  const sectionMatch = text.match(/(?:^|\n)#{0,3}\s*证据[清单列]?[：:]?\s*\n+([\s\S]*?)$/);
  const section = sectionMatch && sectionMatch[1] ? sectionMatch[1] : '';
  if (!section) return [];
  const items: ParsedEvidence[] = [];
  // 匹配 "证据 1: xxx" "1. xxx" "(1) xxx"
  const re = /^[ \t]*(?:证据\s*)?[（(]?(\d+)[）)][、.．:\s]+([^\n]+)/gm;
  let m: RegExpExecArray | null;
  let idx = 0;
  while ((m = re.exec(section)) !== null && idx < 30) {
    idx++;
    if (!m[1] || !m[2]) continue;
    const name = m[2].trim().slice(0, 50);
    if (name.length < 2) continue;
    items.push({
      index: idx,
      name,
      kind: guessKind(name),
      purpose: '',
    });
  }
  return items;
}

function guessKind(name: string): string {
  if (/(截图|公证书|网页|微博|抖音|聊天记录|电子数据)/.test(name)) return '电子数据';
  if (/(合同|发票|通知|证明|证书|文件)/.test(name)) return '书证';
  if (/(录音|录像|视频|音频)/.test(name)) return '视听资料';
  return '书证';
}

function extractLegalBasis(text: string): string[] {
  const items = new Set<string>();
  // 抽 "《...》第 X 条" / "《...》第X条" / "...第 X 条" / "第一千零二十四条"
  // 1) 完整书名号引用
  const re1 = /《[^》]+》第[\s零一二三四五六七八九十百千\d]+条/g;
  let m: RegExpExecArray | null;
  while ((m = re1.exec(text)) !== null) {
    items.add(m[0].trim());
  }
  // 2) 民法典/民诉法 + 条文 (无书名号)
  const re2 = /(民法典|民诉法|民事诉讼法)第[\s零一二三四五六七八九十百千\d]+条/g;
  while ((m = re2.exec(text)) !== null) {
    items.add(m[0].trim());
  }
  // 3) 最高法规定/解答
  const re3 = /最高人民法院[\s\S]{0,30}?(?:解答|规定|意见)/g;
  while ((m = re3.exec(text)) !== null) {
    items.add(m[0].trim().replace(/\s+/g, '').slice(0, 50));
  }
  return Array.from(items);
}

function estimateElementScore(text: string, facts: ParsedFacts): ElementScore {
  // 简单的评分: 内容越具体 → 越 likely_true
  const hasQuoted = /[""「」"]/.test(text);
  const hasSpreadingData = /粉丝|浏览|转发|播放/.test(text);
  const hasDamageEvidence = /精神|抑郁|解约|损失/.test(text);

  return {
    factAuthenticity: hasQuoted ? 'disputed' : 'unknown',
    directedness: facts.tortMethod === '（未识别）' ? 'low' : 'medium',
    fault: 'unknown',
    damage: hasDamageEvidence ? 'weak' : 'none_proven',
  };
}

export { LLMResult };
