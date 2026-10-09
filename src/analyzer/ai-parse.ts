/**
 * AI 模式输出解析 — LLM 返回文本 → 校验 → 标准化为 ComplaintAnalysis
 *
 * 独立模块: LLM 输出是外部不可信数据, 这里的 normalize* 是唯一事实源字段兜底
 */
import { extractJsonSource } from '../utils/json-extract.js';
import { classifyLawCategory, extractArticleNumber } from './law-utils.js';
import type {
  ComplaintAnalysis,
  ParsedClaim,
  ParsedParty,
  ParsedEvidence,
  ParsedFacts,
  ElementScore,
  CaseReference,
  LegalBasisItem,
} from './complaint-types.js';

/**
 * 解析 LLM 返回的 JSON (兼容 markdown 包裹 / 前缀文字)
 */
export function parseAndValidateLLMJson(
  raw: string,
  source: string,
): { ok: true; analysis: ComplaintAnalysis } | { ok: false; error: string } {
  const jsonText = extractJsonSource(raw) ?? raw.trim();

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

  // AI 漏抽诉请时显式告警, 否则下游答辩状没有"逐条反驳"且自检无从发现缺口
  if (analysis.claims.length === 0) {
    analysis.warnings.push('AI 未识别出任何诉讼请求, 请检查起诉状"诉讼请求/请求事项"段落, 或改用 --draft 对照');
  }

  return { ok: true, analysis };
}

function normalizeParties(p: Record<string, unknown>): ComplaintAnalysis['parties'] {
  const obj: ComplaintAnalysis['parties'] = {
    原告: normalizeParty((p['原告'] as Record<string, unknown>) ?? p['plaintiff'], '原告'),
    被告: normalizeParty((p['被告'] as Record<string, unknown>) ?? p['defendant'], '被告'),
  };
  if (p['律师'] || p['lawyer']) {
    obj.律师 = normalizeParty((p['律师'] as Record<string, unknown>) ?? (p['lawyer'] as Record<string, unknown>), '律师');
  }
  return obj;
}

function normalizeParty(p: Record<string, unknown> | undefined, role: ParsedParty['role']): ParsedParty {
  if (!p) return { name: '', role };
  return {
    name: String(p['name'] ?? p['姓名'] ?? ''),
    role: (p['role'] as ParsedParty['role']) ?? role,
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
