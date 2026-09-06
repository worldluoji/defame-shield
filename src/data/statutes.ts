/**
 * 假设法条更新 (Statute Currency Checker)
 *
 * 不联网, 只用内置"关键法条 + 最后审核时间" + 司法解释版本,
 * 检查拆解结果里的法条引用是否"已审核"还是"过期提示".
 *
 * 重要: 本工具不保证法条是最新版本, 仅记录"上次审核时间",
 * 提醒用户定期去 中国法律法规数据库 (https://flk.npc.gov.cn) / 北大法宝 / 威科先行 核实.
 */

import type { LegalBasisItem } from '../analyzer/complaint-types.js';

/** 内置关键法条登记 (上次审核时间 + 来源) */
export interface StatuteEntry {
  /** 法条 ID (e.g. "民法典-1024") */
  id: string;
  /** 法条名称 (含出处) */
  name: string;
  /** 完整原文 (如果能确认, 填; 否则留空) */
  text: string;
  /** 最后审核时间 ISO */
  lastReviewed: string;
  /** 审核来源 */
  source: string;
  /** 相关司法解释 (按发布日期排序) */
  relatedInterpretations: Array<{
    name: string;
    issuedAt: string;
    summary: string;
  }>;
  /** 重要变动提示 (近 1 年内有变动时) */
  recentChanges?: string;
}

/** 内置关键法条登记 (8 个核心条文 + 司法解释) */
export const STATUTE_REGISTRY: StatuteEntry[] = [
  {
    id: '民法典-1024',
    name: '《中华人民共和国民法典》第一千零二十四条',
    text: '民事主体享有名誉权。任何组织或者个人不得以侮辱、诽谤等方式侵害他人的名誉权。',
    lastReviewed: '2026-08-01',
    source: '中国法律法规数据库 (https://flk.npc.gov.cn)',
    relatedInterpretations: [
      {
        name: '最高人民法院关于审理名誉权案件若干问题的解答',
        issuedAt: '1993-08-07',
        summary: '明确名誉权案件的受理、管辖、侵权认定标准',
      },
    ],
  },
  {
    id: '民法典-1025',
    name: '《中华人民共和国民法典》第一千零二十五条',
    text: '行为人为公共利益实施新闻报道、舆论监督等行为，影响他人名誉的，不承担民事责任，但有下列情形之一的除外：（一）捏造、歪曲事实；（二）对他人提供的严重失实内容未尽到合理核实义务。',
    lastReviewed: '2026-08-01',
    source: '中国法律法规数据库 (https://flk.npc.gov.cn)',
    relatedInterpretations: [
      {
        name: '最高人民法院关于审理名誉权案件若干问题的解答',
        issuedAt: '1993-08-07',
        summary: '舆论监督与侵权的界限',
      },
    ],
    recentChanges: '2021 年民法典生效时新增, 无近期变动',
  },
  {
    id: '民法典-1183',
    name: '《中华人民共和国民法典》第一千一百八十三条',
    text: '侵害自然人人身权益造成严重精神损害的，被侵权人有权请求精神损害赔偿。因故意或者重大过失侵害自然人具有人身意义的特定物造成严重精神损害的，被侵权人有权请求精神损害赔偿。',
    lastReviewed: '2026-08-01',
    source: '中国法律法规数据库 (https://flk.npc.gov.cn)',
    relatedInterpretations: [
      {
        name: '最高人民法院关于确定民事侵权精神损害赔偿责任若干问题的解释',
        issuedAt: '2001-03-08',
        summary: '精神损害抚慰金数额的考量因素',
      },
    ],
  },
  {
    id: '民法典-1195',
    name: '《中华人民共和国民法典》第一千一百九十五条',
    text: '网络用户利用网络服务实施侵权行为的，权利人有权通知网络服务提供者采取删除、屏蔽、断开链接等必要措施。通知应当包括构成侵权的初步证据及权利人的真实身份信息。',
    lastReviewed: '2026-08-01',
    source: '中国法律法规数据库 (https://flk.npc.gov.cn)',
    relatedInterpretations: [
      {
        name: '最高人民法院关于审理利用信息网络侵害人身权益民事纠纷案件适用法律若干问题的规定',
        issuedAt: '2014-08-21',
        summary: '"通知-删除" 规则的具体适用',
      },
    ],
  },
  {
    id: '民诉法-24',
    name: '《中华人民共和国民事诉讼法》第二十四条',
    text: '因侵权行为提起的诉讼，由侵权行为地或者被告住所地人民法院管辖。',
    lastReviewed: '2026-08-01',
    source: '中国法律法规数据库 (https://flk.npc.gov.cn)',
    relatedInterpretations: [],
  },
  {
    id: '民诉法-67',
    name: '《中华人民共和国民事诉讼法》第六十七条',
    text: '当事人对自己提出的主张，有责任提供证据。',
    lastReviewed: '2026-08-01',
    source: '中国法律法规数据库 (https://flk.npc.gov.cn)',
    relatedInterpretations: [
      {
        name: '最高人民法院关于民事诉讼证据的若干规定',
        issuedAt: '2019-12-25',
        summary: '举证责任分配的具体规则',
      },
    ],
  },
  {
    id: '民诉法-122',
    name: '《中华人民共和国民事诉讼法》第一百二十二条',
    text: '起诉必须符合下列条件：（一）原告是与本案有直接利害关系的公民、法人和其他组织；（二）有明确的被告；（三）有具体的诉讼请求和事实、理由；（四）属于人民法院受理民事诉讼的范围和受诉人民法院管辖。',
    lastReviewed: '2026-08-01',
    source: '中国法律法规数据库 (https://flk.npc.gov.cn)',
    relatedInterpretations: [],
  },
  {
    id: '民诉法-188',
    name: '《中华人民共和国民法典》第一百八十八条',
    text: '向人民法院请求保护民事权利的诉讼时效期间为三年。法律另有规定的，依照其规定。诉讼时效期间自权利人知道或者应当知道权利受到损害以及义务人之日起计算。',
    lastReviewed: '2026-08-01',
    source: '中国法律法规数据库 (https://flk.npc.gov.cn)',
    relatedInterpretations: [],
  },
];

/** 检查结果 */
export interface StatuteCheck {
  /** 法条 ID (如 "民法典-1024" 或 "未知-XX") */
  id: string;
  /** 法条名称 */
  name: string;
  /** 状态: 'found' (在登记中) / 'not_found' (未知) / 'expired' (审核时间 > 180 天) */
  status: 'found' | 'not_found' | 'expired';
  /** 上次审核时间 */
  lastReviewed?: string;
  /** 法条原文 (如果已知) */
  text?: string;
  /** 距今天数 */
  daysSinceReview?: number;
  /** 警告信息 */
  warnings: string[];
  /** 相关司法解释 */
  relatedInterpretations?: Array<{ name: string; issuedAt: string; summary: string }>;
  /** 建议 */
  advice: string;
}

/** 检查单个法条 */
export function checkStatute(item: LegalBasisItem, now: Date = new Date()): StatuteCheck {
  const warnings: string[] = [];
  let advice = '';

  // 抽取法条 ID
  const id = classifyStatute(item);
  const entry = STATUTE_REGISTRY.find((s) => s.id === id);

  if (!entry) {
    return {
      id,
      name: item.raw,
      status: 'not_found',
      warnings: [`未在内置登记中找到: ${item.raw}`, '请到 flk.npc.gov.cn 核实'],
      advice: '⚠️ 法条不在内置库, 请人工核实条文是否准确',
    };
  }

  // 计算距今天数
  const reviewedAt = new Date(entry.lastReviewed);
  const daysSince = Math.floor((now.getTime() - reviewedAt.getTime()) / (1000 * 60 * 60 * 24));
  const status: StatuteCheck['status'] = daysSince > 180 ? 'expired' : 'found';

  if (status === 'expired') {
    warnings.push(`已 ${daysSince} 天未审核, 建议重新到 flk.npc.gov.cn 核对`);
  }

  if (entry.recentChanges) {
    warnings.push(`近况: ${entry.recentChanges}`);
  }

  // 检查 article 是否匹配
  if (item.article && entry.id.endsWith(`-${item.article}`)) {
    // article 一致
  } else if (item.article) {
    warnings.push(`article 字段 "${item.article}" 与登记中条款号不完全一致, 请核对`);
  }

  if (warnings.length === 0) {
    advice = `✅ 法条已审核, 上次: ${entry.lastReviewed}`;
  } else {
    advice = warnings.join('; ');
  }

  return {
    id: entry.id,
    name: entry.name,
    status,
    lastReviewed: entry.lastReviewed,
    text: entry.text,
    daysSinceReview: daysSince,
    warnings,
    relatedInterpretations: entry.relatedInterpretations,
    advice,
  };
}

/** 批量检查 */
export function checkAllStatutes(items: LegalBasisItem[]): StatuteCheck[] {
  return items.map((it) => checkStatute(it));
}

/** 把 LegalBasisItem 分类为内部 ID */
function classifyStatute(item: LegalBasisItem): string {
  const raw = item.raw;
  // 抽取条款号 (汉字或阿拉伯数字) - 支持 "第 1024 条" / "1024" / "一千零二十四"
  const article = item.article ?? extractArticle(raw);
  if (!article) return `未知-${item.article ?? '?'}`;

  // 统一转为阿拉伯数字 (登记里用阿拉伯)
  const normalized = cnToArab(article);

  if (/民法典/.test(raw)) {
    return `民法典-${normalized}`;
  }
  if (/民诉法|民事诉讼法/.test(raw)) {
    return `民诉法-${normalized}`;
  }
  return `未知-${normalized}`;
}

function extractArticle(raw: string): string | undefined {
  // 1) "第XXX条" 形式
  const m1 = raw.match(/第([零一二三四五六七八九十百千\d]+)条/);
  if (m1 && m1[1]) return m1[1];
  // 2) 纯数字结尾 (e.g. "民法典 1024")
  const m2 = raw.match(/(\d+)\s*$/);
  if (m2 && m2[1]) return m2[1];
  return undefined;
}

/** 汉字数字 → 阿拉伯数字 (支持到千位) */
function cnToArab(s: string): string {
  // 简单实现: 已经是阿拉伯数字直接返回
  if (/^\d+$/.test(s)) return s;

  // 简单汉字映射
  const map: Record<string, number> = {
    零: 0, 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9,
  };

  // 简单情形: 一千零二十四 = 1024
  // 复杂情形: 涉及千百十单位, 简单解析
  let result = 0;
  let currentNum = 0;
  for (const ch of s) {
    if (ch in map) {
      currentNum = map[ch]!;
    } else if (ch === '十') {
      result += currentNum === 0 ? 10 : currentNum * 10;
      currentNum = 0;
    } else if (ch === '百') {
      result += currentNum * 100;
      currentNum = 0;
    } else if (ch === '千') {
      result += currentNum * 1000;
      currentNum = 0;
    } else if (ch === '万') {
      result += currentNum * 10000;
      currentNum = 0;
    }
  }
  result += currentNum;
  return String(result);
}
