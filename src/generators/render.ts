/**
 * 模板变量替换 — 支持 {{ 路径.字段 }} 和 {{ 字段 }} 两种语法
 * 路径支持 a.b.c 嵌套, 如 {{ 原告.name }}、{{ 案件事实.侵权内容 }}
 */
import type { Case } from '../case/types.js';

export type TemplateVars = Record<string, unknown>;

/** 把 Case 拍平成模板变量 */
export function caseToVars(c: Case): TemplateVars {
  return {
    id: c.id,
    title: c.title,
    案由: c.cause,
    管辖法院: c.court ?? '',
    原告: c.plaintiff,
    被告: c.defendant,
    律师: c.lawyer ?? {},
    事实摘要: c.facts,
    '案件事实.侵权方式': extractTortMethod(c.facts),
    '案件事实.侵权内容': extractTortContent(c.facts),
    诉讼请求: c.claims,
    证据: c.evidence,
    证据数量: c.evidence.length,
    证据表格行: renderEvidenceRows(c.evidence),
    书证数量: c.evidence.filter((e) => e.kind === '书证').length,
    视听资料数量: c.evidence.filter((e) => e.kind === '视听资料').length,
    电子数据数量: c.evidence.filter((e) => e.kind === '电子数据').length,
    物证数量: c.evidence.filter((e) => e.kind === '物证').length,
    证人证言数量: c.evidence.filter((e) => e.kind === '证人证言').length,
    鉴定意见数量: c.evidence.filter((e) => e.kind === '鉴定意见').length,
    勘验笔录数量: c.evidence.filter((e) => e.kind === '勘验笔录').length,
    书证编号: filterEvidenceByKind(c.evidence, '书证'),
    视听资料编号: filterEvidenceByKind(c.evidence, '视听资料'),
    电子数据编号: filterEvidenceByKind(c.evidence, '电子数据'),
    物证编号: filterEvidenceByKind(c.evidence, '物证'),
    证人证言编号: filterEvidenceByKind(c.evidence, '证人证言'),
    鉴定意见编号: filterEvidenceByKind(c.evidence, '鉴定意见'),
    勘验笔录编号: filterEvidenceByKind(c.evidence, '勘验笔录'),
    要求期限: '7',
    致歉保留天数: '30',
    被告数量: '1',
    原告数量: '1',
    今日日期: new Date().toISOString().slice(0, 10),
  };
}

/** 渲染证据表格的 Markdown 行 */
function renderEvidenceRows(evidence: Case['evidence']): string {
  return evidence
    .map(
      (e) =>
        `| ${e.index} | ${escapeMd(e.name)} | ${e.kind} | ${escapeMd(e.purpose)} | ${escapeMd(e.source ?? '-')} | ${e.acquiredAt ?? '-'} | ${escapeMd(e.filePath ?? '-')} |`,
    )
    .join('\n');
}

function filterEvidenceByKind(
  evidence: Case['evidence'],
  kind: Case['evidence'][number]['kind'],
): string {
  const list = evidence.filter((e) => e.kind === kind).map((e) => e.index);
  return list.length > 0 ? list.join('、') : '—';
}

/** 简易提取: 事实摘要中包含"通过 ... 方式"则取该片段; 否则空 */
function extractTortMethod(facts: string): string {
  const m = facts.match(/通过([^，,。;；]{2,40}?)(?:发布|传播|撰文|发文)/);
  return m && m[1] ? m[1].trim() : '（详见事实摘要）';
}

/** 简易提取: 事实摘要中"内容为 ...""内容如下: ...""所述:"后的第一句 (到第一个句末标点) */
function extractTortContent(facts: string): string {
  const m = facts.match(/(?:内容为|内容如下|内容如下：|所述：|所述:)([\s\S]{0,500}?)[。！？]/);
  return m && m[1] ? m[1].trim() : facts.slice(0, 200);
}

function escapeMd(s: string): string {
  return s.replace(/\|/g, '\\|').replace(/\n/g, ' ');
}

/**
 * 替换模板中的 {{ key }} 或 {{ key.path }}
 * - 字符串空值/未找到 → 渲染为 `__________` (法律文书占位惯例)
 * - 仅当 rawKey 包含中文"待补"或显式未定义字段, 才保持原样
 * - 对象/数组用 JSON.stringify
 */
export function renderTemplate(template: string, vars: TemplateVars): string {
  return template.replace(/\{\{\s*([^}]+?)\s*\}\}/g, (_match, rawKey: string) => {
    const value = resolveKey(vars, rawKey);
    if (value === undefined || value === null) return '__________';
    if (typeof value === 'string') {
      const trimmed = value.trim();
      if (trimmed === '') return '__________';
      return trimmed;
    }
    if (typeof value === 'object') return JSON.stringify(value, null, 2);
    return String(value);
  });
}

function resolveKey(vars: TemplateVars, key: string): unknown {
  // 1) 先尝试整段 key 直接命中 (e.g. "案件事实.侵权内容" 是字面 key)
  if (key in vars) return vars[key];
  // 2) 再尝试按 dot path 拆嵌套 (e.g. "原告.name" → vars.原告.name)
  const parts = key.split('.');
  let cur: unknown = vars;
  for (const p of parts) {
    if (cur && typeof cur === 'object' && p in (cur as Record<string, unknown>)) {
      cur = (cur as Record<string, unknown>)[p];
    } else {
      return undefined;
    }
  }
  return cur;
}
