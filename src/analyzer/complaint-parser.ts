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
  LegalBasisItem,
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
按编号提取每条证据的：
- name: 名称
- kind: 种类
- purpose: 证明目的
- source: 来源/出处
- acquiredAt: 取得时间 (ISO 格式 YYYY-MM-DD)
- notarized: 是否经公证 (true/false)
- notaryInfo: 公证机构及编号

### 5. 法律依据 (legalBasis + legalBasisItems)
原告引用的所有法条，逐条列出：
- legalBasis: 字符串数组 (e.g. ["《中华人民共和国民法典》第一千零二十四条"])
- legalBasisItems: 结构化对象数组，每条含:
  - raw: 法条原文
  - category: 民法典 / 民诉法 / 司法解释 / 其他
  - article: 条款号 (e.g. "1024")
  - articleText: 法条原文内容 (从公开法条库获取, 若无法获取可留空)

### 6. 起诉法院 (courtOfFiling)
"此致" 后面的人民法院名称, 例如 "北京市朝阳区人民法院"。

### 7. 起诉日期 (filingDate)
起诉状落款日期: "具状人/起诉人" 之后所载的年/月/日, 或正文中 "于 X 年 X 月 X 日提起本诉/起诉" 的日期。输出 ISO 格式 YYYY-MM-DD (只有年月时输出 YYYY-MM)。起诉状中确实没有日期则输出 null。

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
  const legalBasisItems = normalizeLegalBasisItems(obj.legalBasisItems as unknown[] | undefined, obj.legalBasis as unknown[]);
  const analysis: ComplaintAnalysis = {
    source,
    analyzedAt: new Date().toISOString(),
    mode: 'ai',
    parties: normalizeParties(obj.parties as Record<string, unknown>),
    cause: String(obj.cause ?? ''),
    claims: normalizeClaims(obj.claims as unknown[]),
    facts: normalizeFacts(obj.facts as Record<string, unknown>),
    evidence: normalizeEvidence(obj.evidence as unknown[] | undefined),
    legalBasis: legalBasisItems.map((i) => i.raw),
    legalBasisItems,
    elementScore: normalizeElementScore(obj.elementScore as Record<string, unknown> | undefined),
    rebuttalPriority: normalizePriority(obj.rebuttalPriority as unknown[] | undefined, obj.claims as unknown[]),
    confidence: typeof obj.confidence === 'number' ? Math.max(0, Math.min(1, obj.confidence)) : 0.5,
    warnings: Array.isArray(obj.warnings) ? obj.warnings.map(String) : [],
    caseReferences: Array.isArray(obj.caseReferences)
      ? (obj.caseReferences as CaseReference[])
      : undefined,
    courtOfFiling: obj.courtOfFiling || obj['court'] || obj['起诉法院']
      ? String(obj.courtOfFiling ?? obj['court'] ?? obj['起诉法院'])
      : undefined,
    filingDate: obj.filingDate || obj['起诉日期']
      ? String(obj.filingDate ?? obj['起诉日期'])
      : undefined,
    caseNumber: obj.caseNumber || obj['案号'] ? String(obj.caseNumber ?? obj['案号']) : undefined,
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
        source: o['source'] || o['来源'] ? String(o['source'] ?? o['来源']) : undefined,
        acquiredAt: o['acquiredAt'] || o['取得时间'] ? String(o['acquiredAt'] ?? o['取得时间']) : undefined,
        notarized: o['notarized'] === true || /公证书|公证/.test(String(o['name'] ?? o['名称'] ?? '')),
        notaryInfo: o['notaryInfo'] || o['公证信息'] ? String(o['notaryInfo'] ?? o['公证信息']) : undefined,
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
 * 标准化法律依据 — 字符串列表 → 结构化
 * 兼容:
 *   - 结构化对象数组: [{raw, category, article, articleText}, ...]
 *   - 字符串数组: ["民法典第一千零二十四条", ...] → 转结构化
 */
function normalizeLegalBasisItems(structured: unknown[] | undefined, fallback: unknown[] | undefined): LegalBasisItem[] {
  if (Array.isArray(structured) && structured.length > 0 && typeof structured[0] === 'object') {
    return structured.map((item) => {
      const o = item as Record<string, unknown>;
      const raw = String(o['raw'] ?? o['法条'] ?? '');
      return {
        raw,
        category: (o['category'] as LegalBasisItem['category']) ?? classifyLawCategory(raw),
        article: o['article'] ? String(o['article']) : extractArticleNumber(raw),
        articleText: o['articleText'] ? String(o['articleText']) : undefined,
      };
    });
  }
  // fallback: 字符串数组
  if (Array.isArray(fallback)) {
    return fallback.filter((s) => typeof s === 'string' && s.length > 0).map((s) => {
      const raw = String(s);
      return {
        raw,
        category: classifyLawCategory(raw),
        article: extractArticleNumber(raw),
      };
    });
  }
  return [];
}

function classifyLawCategory(raw: string): LegalBasisItem['category'] {
  if (/民法典/.test(raw)) return '民法典';
  if (/民诉法|民事诉讼法/.test(raw)) return '民诉法';
  if (/最高法|最高人民法院|司法解释|解答|规定/.test(raw)) return '司法解释';
  return '其他';
}

function extractArticleNumber(raw: string): string | undefined {
  // 匹配 "第xxx条" 中的 xxx (数字或汉字)
  const m = raw.match(/第([零一二三四五六七八九十百千\d]+)条/);
  if (!m || !m[1]) return undefined;
  return m[1];
}

/**
 * 关键词抽取 — 不调 LLM, 粗糙但可用
 */
function extractByKeywords(text: string, source: string): ComplaintAnalysis {
  const warnings: string[] = [];

  // 姓名抽取
  const plaintiffName = extractName(text, '原告');
  const defendantName = extractName(text, '被告');

  // 诉请抽取
  const claims = extractClaims(text);
  if (claims.length === 0) warnings.push('未能识别诉请, 请人工检查');

  // 事实抽取
  const facts = extractFacts(text);
  if (!facts.time) warnings.push('未识别到侵权时间, 诉讼时效反点无法自动评估');

  // 证据抽取
  const evidence = extractEvidence(text);

  // 法条抽取
  const legalBasisRaw = extractLegalBasis(text);
  const legalBasisItems = legalBasisRaw.map((raw) => ({
    raw,
    category: classifyLawCategory(raw) as LegalBasisItem['category'],
    article: extractArticleNumber(raw),
  }));

  // 起诉法院抽取
  const courtOfFiling = extractCourtOfFiling(text);

  // 起诉日期抽取 (诉讼时效计算基准)
  const filingDate = extractFilingDate(text);

  // 元素评分 (粗略)
  const elementScore = estimateElementScore(text);

  // 反驳优先级
  const rebuttalPriority = claims.map((c) => c.index);

  // 置信度启发式: 按抽取完整度累加, draft 封顶 0.7 (规则抽取不可能比 AI 更自信)
  let confidence = 0.2;
  if (plaintiffName) confidence += 0.1;
  if (defendantName) confidence += 0.1;
  if (courtOfFiling) confidence += 0.05;
  if (filingDate) confidence += 0.05;
  if (facts.time) confidence += 0.05;
  confidence += Math.min(0.15, claims.length * 0.05);
  confidence = Math.min(0.7, Math.round(confidence * 100) / 100);

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
    legalBasis: legalBasisRaw,
    legalBasisItems,
    elementScore,
    rebuttalPriority,
    confidence,
    warnings,
    courtOfFiling,
    filingDate,
  };
}

/**
 * 抽取起诉法院 — "此致" 后面或单独 "向 XX 法院 提起诉讼"
 */
function extractCourtOfFiling(text: string): string | undefined {
  // 1) "此致\n\nXX 法院" / "此致 XX 法院"
  let m = text.match(/此致\s*\n?\s*([^\n]+人民法院)/);
  if (m && m[1]) return m[1].trim();

  // 2) "向 XX 法院 提起诉讼"
  m = text.match(/向\s*([^\n。]+?人民法院)\s*提起/);
  if (m && m[1]) return m[1].trim();

  // 3) 单独的 "XX 人民法院" 出现在正文末尾
  const matches = text.match(/[\u4e00-\u9fa5]{2,30}人民法院/g);
  if (matches && matches.length > 0) return matches[matches.length - 1]!.trim();

  return undefined;
}

function extractName(text: string, role: string): string {
  // 优先匹配 Markdown "## 原告" 标题块
  const sectionRe = new RegExp(`##\\s*${role}[\\s\\S]{0,300}`, 'm');
  const section = text.match(sectionRe)?.[0] ?? '';
  if (section) {
    // 跳过 markdown 强调 ** **, 然后匹配 "姓名: 张三" / "姓名/名称：张三" / "名称 张三"
    // {2,20}: 公司法人名称普遍 10 字以上, 截到 8 字会得到残缺名称
    const m = section.match(/(?:姓名|名称)[/\\s]*\*?\*?\s*[:：]\s*\*?\*?([^\n*，,\s]{2,20})/)?.[1];
    if (m && m !== '姓名' && m !== '名称') return m.trim();
  }
  // 兜底: "原告张三" "原告：张三" "被告李四"
  // 与/和/及/的 作停止字符, 防止叙述句 ("原告与被告达成…") 被当名称吃进去
  const inlineM = text.match(new RegExp(`${role}[:：]?\\s*([^\\s\\n,，、:：*与和及的]{2,20})`, 'm'))?.[1];
  return inlineM && inlineM !== '姓名' && inlineM !== '名称' ? inlineM.trim() : '';
}

/** 清洗 PDF→markdown 逐字换行: 去空格, 但保留数字/字母之间的断行 (如 "1. 1万余次") */
function joinCjk(s: string): string {
  return s.replace(/([一-龥，。、；：（）""''《》%])[ \t\n]+(?=[一-龥，。、；：（）""''《》])/g, '$1');
}

/** PDF 转换产生的噪声行: 页码/骑缝残字 (应过滤, 不当作诉请续行) */
function isNoiseLine(t: string): boolean {
  return /^\d{1,3}$/.test(t) || /^[一-龥]{1,2}$/.test(t) || /^[-—*_·\s]+$/.test(t);
}

function extractClaims(text: string): ParsedClaim[] {
  // 段标题: 诉讼请求 / 请求事项 (真实起诉状两种都有), 可带可不带 markdown 井号
  const sectionMatch = text.match(
    /(?:^|\n)[# \t*]*(?:诉讼请求|请求事项)[# \t]*[:：]?[ \t]*\n([\s\S]*?)(?=\n[# \t*]*(?:事实[与和]理由|法律依据|证据清单|此致)|\n综上|$)/,
  );
  if (!sectionMatch || !sectionMatch[1]) return [];
  const section = sectionMatch[1];
  const items: ParsedClaim[] = [];

  const finish = (index: number, parts: string[]): void => {
    const content = joinCjk(parts.join(' ')).replace(/\s+/g, ' ').trim();
    if (content.length > 5) {
      items.push({
        index,
        content: content.slice(0, 200),
        type: classifyClaim(content),
        amount: extractAmount(content),
      });
    }
  };

  // 逐行扫: "1. xxx" / "(1) xxx" / "1、xxx" 开头为新诉请; 后续非编号行是 PDF 换行的续行
  let cur: { index: number; parts: string[] } | null = null;
  for (const raw of section.split('\n')) {
    const t = raw.trim();
    if (!t) continue;
    const m = t.match(/^[（(]?(\d+)[）)]?[、.．:：\s]\s*(.+)$/) ?? t.match(/^[一二三四五六七八九十]+[、.．]\s*(.+)$/);
    if (m) {
      if (cur) finish(cur.index, cur.parts);
      cur = /^\d/.test(m[1]!)
        ? { index: parseInt(m[1]!, 10), parts: [m[2]!] }
        : { index: items.length + 1, parts: [m[1]!] };
    } else if (cur && !isNoiseLine(t)) {
      cur.parts.push(t);
    }
  }
  if (cur) finish(cur.index, cur.parts);
  return items;
}

function classifyClaim(content: string): ParsedClaim['type'] {
  if (/(停止侵害|删除|屏蔽|断开链接|下架)/.test(content)) return 'stop_infringement';
  // "道歉声明置顶 N 日, 消除...不良影响" 是真实起诉状里恢复名誉的主要形态, 措辞常不连续
  if (/(赔礼道歉|道歉|致歉|恢复名誉)/.test(content) || /消除[^。\n]{0,20}影响/.test(content)) return 'restore_reputation';
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

const TORT_PLATFORM_RE = /(新浪微博|微博|抖音|微信|朋友圈|公众号|视频号|哔哩哔哩|B站|b站|快手|小红书|知乎|豆瓣|贴吧|今日头条|头条|短视频|网站|论坛|报纸|杂志|电台|电视台)/;

/**
 * 侵权平台识别 — 优先取"发布/上传/直播"等侵权行为动词前 80 字内的平台词,
 * 避免全文首个命中造成误报 (如被告公司简介里的"互联网电视")
 */
function findTortPlatform(section: string): string | undefined {
  for (const v of section.matchAll(/(?:发布|发表|上传|发帖|撰写|直播|刊登|转载|置顶)/g)) {
    const win = section.slice(Math.max(0, v.index - 80), v.index);
    const pm = win.match(TORT_PLATFORM_RE);
    if (pm && pm[1]) return pm[1];
  }
  const all = section.match(TORT_PLATFORM_RE);
  return all ? all[1] : undefined;
}

const TORT_ACTION_VERB_RE = /(发布|发表|上传|发帖|撰写|直播|刊登|转载|置顶|侮辱|诽谤)/;

/**
 * 侵权时间 — 保守策略: 只认句/行首日期, 且"同一句"内须同时出现 被告/被诉/侵权 与侵权行为动词。
 * 事实段里公司成立日/公告日 ("2021年3月30日, 原告在港交所发布公告") 同样含动词"发布",
 * 但句中无"被告", 据此排除 — 抓到历史日期会让诉讼时效反点误报。
 */
function findTortTime(section: string): string | undefined {
  for (const m of section.matchAll(/(?:^|[。\n])\s*(\d{4}\s*年(?:\s*\d{1,2}\s*月(?:\s*\d{1,2}\s*日)?)?)/g)) {
    const sentence = section.slice(m.index + m[0].length).split('。')[0] ?? '';
    if (/(被告|被诉|侵权)/.test(sentence) && TORT_ACTION_VERB_RE.test(sentence)) {
      return m[1]!.replace(/\s+/g, ' ').trim();
    }
  }
  const on = section.match(/于\s*(\d{4}\s*年(?:\s*\d{1,2}\s*月(?:\s*\d{1,2}\s*日)?)?)\s*(?:发布|发表|撰写|发帖|上传|转发)/);
  return on?.[1]?.replace(/\s+/g, ' ').trim();
}

function extractFacts(text: string): ParsedFacts {
  // 段标题: "事实与理由" / "事实和理由", markdown 井号与冒号可有可无 (PDF 转换多为纯文本)
  const sectionMatch = text.match(
    /(?:^|\n)[# \t*]*事实[与和]理由[# \t]*[:：]?[ \t]*\n?([\s\S]*?)(?=\n[# \t*]*(?:法律依据|证据清单|此致)|\n综上|$)/,
  );
  // joinCjk: PDF 逐字换行会把 "哔哩哔哩" 拆成 "哔哩\n哔哩", 先拼回再抽取平台/时间/内容
  const section = joinCjk(sectionMatch && sectionMatch[1] ? sectionMatch[1].trim() : text);

  const tortMethod = findTortPlatform(section) ??
    section.match(/(?:通过|利用)([^，,。;；\n]{2,30}?)(?:发布|传播|发帖|撰文)/)?.[1]?.trim() ??
    '（未识别）';

  const tortContent =
    section.match(/(?:内容为|内容包含|所述为|表述为|写道|声称)[:：]?[""「」]?([\s\S]{20,500}?)[""」]?(?:[。！？\n]|$)/)?.[1]?.trim() ??
    section.slice(0, 300);

  const spread =
    section.match(/(粉丝\s*[\d,，]+|浏览\s*[\d,，]+|阅读\s*[\d,，]+|转发\s*[\d,，]+|播放\s*[\d,，]+|播放量[^\d\n]{0,8}\d[\d,，]*)/)?.[0] ??
    '';

  // 抓不到就留空 — 宁可缺数据也不误报年份 (诉讼时效反点依赖此字段)
  const time = findTortTime(section);

  return {
    tortMethod,
    tortContent: tortContent.slice(0, 500),
    spread,
    time,
  };
}

/**
 * 起诉日期 — 优先 "此致" 之后的落款 (具状人/起诉人 + 年月日),
 * 兜底 "于 X 年 X 月 X 日提起(本)诉" 字样
 */
function extractFilingDate(text: string): string | undefined {
  const fmt = (m: RegExpMatchArray): string => {
    const y = m[1]!;
    const mo = m[2] ? m[2].padStart(2, '0') : undefined;
    const d = m[3] ? m[3].padStart(2, '0') : undefined;
    if (mo && d) return `${y}-${mo}-${d}`;
    if (mo) return `${y}-${mo}`;
    return y;
  };
  const refIdx = text.lastIndexOf('此致');
  const tail = refIdx >= 0 ? text.slice(refIdx) : text.slice(-400);
  let m = tail.match(/(\d{4})\s*年\s*(\d{1,2})\s*月\s*(\d{1,2})\s*日/);
  if (m) return fmt(m);
  m = tail.match(/(\d{4})\s*年\s*(\d{1,2})\s*月/);
  if (m) return fmt(m);
  m = text.match(/于\s*(\d{4})\s*年\s*(\d{1,2})\s*月(?:\s*(\d{1,2})\s*日)?\s*(?:提起|起诉)/);
  if (m) return fmt(m);
  return undefined;
}

function extractEvidence(text: string): ParsedEvidence[] {
  // 只在"证据"段抽取 (起诉状末尾的"证据清单"小节)
  const sectionMatch = text.match(/(?:^|\n)#{0,3}\s*证据(?:清单|目录|列表)?[：:]?\s*\n+([\s\S]*?)$/);
  const section = sectionMatch && sectionMatch[1] ? sectionMatch[1] : '';
  if (!section) return [];
  const items: ParsedEvidence[] = [];
  // 匹配 "证据 1: xxx" "1. xxx" "(1) xxx" "1、xxx"
  const re = /^[ \t]*(?:证据\s*)?[（(]?(\d+)[）)]?[、.．:\s]+([^\n]+)/gm;
  let m: RegExpExecArray | null;
  let idx = 0;
  while ((m = re.exec(section)) !== null && idx < 30) {
    idx++;
    if (!m[1] || !m[2]) continue;
    const fullText = m[2].trim();
    const name = fullText.slice(0, 50);
    if (name.length < 2) continue;

    // 提取来源: "出自 XX" / "来源: XX" / "XX公证处" / "XX公司"
    const sourceMatch = fullText.match(/(?:来源|出自|由|系)[:：]?\s*([^\n,，;；)）]{2,30})/) ||
                        fullText.match(/([\u4e00-\u9fa5]{2,15}(?:公证处|人民法院|公司|医院|律师事务所))/);
    const source = sourceMatch && sourceMatch[1] ? sourceMatch[1].trim() : undefined;

    // 提取时间: 2025-06-02 / 2025年6月2日
    const dateMatch = fullText.match(/(\d{4})[-年](\d{1,2})[-月](\d{1,2})/);
    const acquiredAt = dateMatch ? `${dateMatch[1]}-${dateMatch[2]!.padStart(2, '0')}-${dateMatch[3]!.padStart(2, '0')}` : undefined;

    // 公证检测
    const notarized = /公证书|公证[处局]|经.*?公证/.test(fullText);
    const notaryInfo = fullText.match(/(.{0,10}公证(?:处|局|员)?[，,]?\s*公证书?[号码字]?[为]?\s*[\d零一二三四五六七八九]+)/)?.[0];

    items.push({
      index: idx,
      name,
      kind: guessKind(name),
      purpose: '',
      source,
      acquiredAt,
      notarized,
      notaryInfo,
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

function estimateElementScore(text: string): ElementScore {
  // 简单的评分: 内容越具体 → 越 likely_true
  const hasQuoted = /[""「」"]/.test(text);
  const hasDamageEvidence = /精神|抑郁|解约|损失/.test(text);

  return {
    factAuthenticity: hasQuoted ? 'disputed' : 'unknown',
    // 未识别侵权方式 ≠ 内容不指向原告; 保持 medium, 让反点选择走保守路径
    directedness: 'medium',
    fault: 'unknown',
    damage: hasDamageEvidence ? 'weak' : 'none_proven',
  };
}

export { LLMResult };
