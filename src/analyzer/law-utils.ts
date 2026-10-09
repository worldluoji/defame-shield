/**
 * 法条文本书面工具 — AI 解析与 draft 抽取两侧共用
 */
import type { LegalBasisItem } from './complaint-types.js';

export function classifyLawCategory(raw: string): LegalBasisItem['category'] {
  if (/民法典/.test(raw)) return '民法典';
  if (/民诉法|民事诉讼法/.test(raw)) return '民诉法';
  if (/最高法|最高人民法院|司法解释|解答|规定/.test(raw)) return '司法解释';
  return '其他';
}

export function extractArticleNumber(raw: string): string | undefined {
  // 匹配 "第xxx条" 中的 xxx (数字或汉字)
  const m = raw.match(/第([零一二三四五六七八九十百千\d]+)条/);
  if (!m || !m[1]) return undefined;
  return m[1];
}
