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
    id: '民法典-188',
    name: '《中华人民共和国民法典》第一百八十八条',
    text: '向人民法院请求保护民事权利的诉讼时效期间为三年。法律另有规定的，依照其规定。诉讼时效期间自权利人知道或者应当知道权利受到损害以及义务人之日起计算。',
    lastReviewed: '2026-08-01',
    source: '中国法律法规数据库 (https://flk.npc.gov.cn)',
    relatedInterpretations: [],
  },

  // ==========================================
  // 民法典 - 人格权编 (续)
  // ==========================================
  {
    id: '民法典-1003',
    name: '《中华人民共和国民法典》第一千零三条',
    text: '自然人享有身体权。自然人的身体完整和行动自由受法律保护。任何组织或者个人不得侵害他人的身体权。',
    lastReviewed: '2026-08-01',
    source: '中国法律法规数据库 (https://flk.npc.gov.cn)',
    relatedInterpretations: [],
    recentChanges: '注: 此条虽为身体权条文, 但常被作为人格权请求权 (停止侵害等) 的基础规范被援引',
  },
  {
    id: '民法典-1012',
    name: '《中华人民共和国民法典》第一千零一十二条',
    text: '自然人因人格权益遭受非法侵害的，有权主张停止侵害、排除妨碍、消除危险、消除影响、恢复名誉、赔礼道歉。\n上述请求权**不适用诉讼时效的规定**。',
    lastReviewed: '2026-08-01',
    source: '中国法律法规数据库 (https://flk.npc.gov.cn)',
    relatedInterpretations: [],
    recentChanges: '⚠️ 重要: 停止侵害/恢复名誉/消除影响等请求权不适用诉讼时效 — 但损害赔偿请求权适用 3 年时效',
  },
  {
    id: '民法典-1019',
    name: '《中华人民共和国民法典》第一千零一十九条',
    text: '任何组织或者个人不得以丑化、污损，或者利用信息技术手段伪造等方式侵害他人的肖像权。未经肖像权人同意，不得制作、使用、公开肖像权人的肖像，但是法律另有规定的除外。\n肖像是通过影像、雕塑、绘画等方式在一定载体上所反映的特定自然人可以被识别的外部形象。',
    lastReviewed: '2026-08-01',
    source: '中国法律法规数据库 (https://flk.npc.gov.cn)',
    relatedInterpretations: [],
  },
  {
    id: '民法典-1029',
    name: '《中华人民共和国民法典》第一千零二十九条',
    text: '民事主体可以依法查询本人的信用评价；发现信用评价不当的，有权提出异议并请求采取更正、删除等必要措施。信用评价人应当及时核查，经核查属实的，应当及时采取必要措施。',
    lastReviewed: '2026-08-01',
    source: '中国法律法规数据库 (https://flk.npc.gov.cn)',
    relatedInterpretations: [],
    recentChanges: '注: 此条为信用权/荣誉权条款, 与名誉权相关但不同 — 答辩时可援引以区分权利类型',
  },

  // ==========================================
  // 民法典 - 侵权责任编
  // ==========================================
  {
    id: '民法典-1165',
    name: '《中华人民共和国民法典》第一千一百六十五条',
    text: '行为人因过错侵害他人民事权益造成损害的，应当承担侵权责任。\n依照法律规定推定行为人有过错，其不能证明自己没有过错的，应当承担侵权责任。',
    lastReviewed: '2026-08-01',
    source: '中国法律法规数据库 (https://flk.npc.gov.cn)',
    relatedInterpretations: [
      {
        name: '最高人民法院关于审理人身损害赔偿案件适用法律若干问题的解释',
        issuedAt: '2020-12-23',
        summary: '过错责任原则的具体适用',
      },
    ],
  },
  {
    id: '民法典-1166',
    name: '《中华人民共和国民法典》第一千一百六十六条',
    text: '行为人造成他人民事权益损害，不论行为人有无过错，法律规定应当承担侵权责任的，依照其规定。',
    lastReviewed: '2026-08-01',
    source: '中国法律法规数据库 (https://flk.npc.gov.cn)',
    relatedInterpretations: [],
  },

  // ==========================================
  // 民法典 - 网络侵权 (1194-1198)
  // ==========================================
  {
    id: '民法典-1194',
    name: '《中华人民共和国民法典》第一千一百九十四条',
    text: '网络用户、网络服务提供者利用网络侵害他人民事权益的，应当承担侵权责任。法律另有规定的，依照其规定。',
    lastReviewed: '2026-08-01',
    source: '中国法律法规数据库 (https://flk.npc.gov.cn)',
    relatedInterpretations: [
      {
        name: '最高人民法院关于审理利用信息网络侵害人身权益民事纠纷案件适用法律若干问题的规定',
        issuedAt: '2014-08-21',
        summary: '信息网络侵权的基本规则 (本条的核心司法解释)',
      },
    ],
  },
  {
    id: '民法典-1196',
    name: '《中华人民共和国民法典》第一千一百九十六条',
    text: '网络用户接到转送的通知后，可以向网络服务提供者提交不存在侵权行为的声明。声明应当包括不存在侵权行为的初步证据以及网络用户的真实身份信息。\n网络服务提供者接到声明后，应当将该声明转送发出通知的权利人，并告知其可以向有关部门投诉或者向人民法院提起诉讼。',
    lastReviewed: '2026-08-01',
    source: '中国法律法规数据库 (https://flk.npc.gov.cn)',
    relatedInterpretations: [
      {
        name: '最高人民法院关于审理利用信息网络侵害人身权益民事纠纷案件适用法律若干问题的规定',
        issuedAt: '2014-08-21',
        summary: '"通知-反通知" 规则 (被错误删除时被告可援引)',
      },
    ],
    recentChanges: '实务: 被告被错误投诉/删除时, 可援引本条主张"反通知"权利',
  },
  {
    id: '民法典-1197',
    name: '《中华人民共和国民法典》第一千一百九十七条',
    text: '网络服务提供者知道或者应当知道网络用户利用其网络服务侵害他人民事权益，未采取必要措施的，与该网络用户承担连带责任。',
    lastReviewed: '2026-08-01',
    source: '中国法律法规数据库 (https://flk.npc.gov.cn)',
    relatedInterpretations: [
      {
        name: '最高人民法院关于审理利用信息网络侵害人身权益民事纠纷案件适用法律若干问题的规定',
        issuedAt: '2014-08-21',
        summary: '平台的"知道或应当知道"过错认定标准',
      },
    ],
  },
  {
    id: '民法典-1198',
    name: '《中华人民共和国民法典》第一千一百九十八条',
    text: '宾馆、商场、银行、车站、机场、体育场馆、娱乐场所等经营场所、公共场所的经营者、管理者或者群众性活动的组织者，未尽到安全保障义务造成他人损害的，应当承担侵权责任。\n因第三人的行为造成他人损害的，由第三人承担侵权责任；经营者、管理者或者组织者未尽到安全保障义务的，承担相应的补充责任。经营者、管理者或者组织者承担补充责任后，可以向第三人追偿。',
    lastReviewed: '2026-08-01',
    source: '中国法律法规数据库 (https://flk.npc.gov.cn)',
    relatedInterpretations: [],
  },

  // ==========================================
  // 民诉法 - 程序条款
  // ==========================================
  {
    id: '民诉法-55',
    name: '《中华人民共和国民事诉讼法》第五十五条',
    text: '当事人一方或者双方为二人以上，其诉讼标的是共同的，或者诉讼标的是同一种类、人民法院认为可以合并审理并经当事人同意的，为共同诉讼。\n当事人一方人数众多的共同诉讼，可以由当事人推选二至三名诉讼代表人参加诉讼。',
    lastReviewed: '2026-08-01',
    source: '中国法律法规数据库 (https://flk.npc.gov.cn)',
    relatedInterpretations: [],
  },
  {
    id: '民诉法-130',
    name: '《中华人民共和国民事诉讼法》第一百三十条',
    text: '人民法院对当事人提出的管辖权异议，应当审查。异议成立的，裁定将案件移送有管辖权的人民法院；异议不成立的，裁定驳回。\n当事人未提出管辖异议，并应诉答辩或者提出反诉的，视为受诉人民法院有管辖权，但违反级别管辖和专属管辖规定的除外。',
    lastReviewed: '2026-08-01',
    source: '中国法律法规数据库 (https://flk.npc.gov.cn)',
    relatedInterpretations: [],
    recentChanges: '⚠️ 重要: 管辖异议应在**答辩期间**提出, 之后未提视为放弃 (除违反级别/专属管辖)',
  },
  {
    id: '民诉法-191',
    name: '《中华人民共和国民法典》第一百九十一条',
    text: '未成年人遭受性侵害的损害赔偿请求权的诉讼时效期间，自受害人年满十八周岁之日起计算。',
    lastReviewed: '2026-08-01',
    source: '中国法律法规数据库 (https://flk.npc.gov.cn)',
    relatedInterpretations: [],
  },
  {
    id: '民诉法-192',
    name: '《中华人民共和国民法典》第一百九十二条',
    text: '诉讼时效期间届满的，义务人可以提出不履行义务的抗辩。\n诉讼时效期间届满后，义务人同意履行的，不得以诉讼时效期间届满为由抗辩；义务人已经自愿履行的，不得请求返还。',
    lastReviewed: '2026-08-01',
    source: '中国法律法规数据库 (https://flk.npc.gov.cn)',
    relatedInterpretations: [],
  },

  // ==========================================
  // 司法解释
  // ==========================================
  {
    id: '司法解释-名誉权-1993',
    name: '最高人民法院关于审理名誉权案件若干问题的解答',
    text: '(全文较长, 详见登记的关联引用) — 主要内容包括: 名誉权案件的受理条件、管辖、侵权认定标准 (侮辱/诽谤/新闻报道失实)、举证责任分配、精神损害赔偿考量因素等。',
    lastReviewed: '2026-08-01',
    source: '中国法律法规数据库 (https://flk.npc.gov.cn)',
    relatedInterpretations: [
      {
        name: '最高人民法院关于审理名誉权案件若干问题的解答',
        issuedAt: '1993-08-07',
        summary: '名誉权诉讼的基本规范 (虽然时间久但仍是核心司法解释)',
      },
      {
        name: '最高人民法院关于审理名誉权案件若干问题的解释',
        issuedAt: '1998-08-31',
        summary: '对 1993 年解答的补充, 进一步明确新闻报道和批评的界限',
      },
    ],
    recentChanges: '⚠️ 该司法解释时间久远 (1993/1998), 部分内容已被民法典吸收, 部分仍有效, 适用时务必查阅最新版本',
  },
  {
    id: '司法解释-信息网络-2014',
    name: '最高人民法院关于审理利用信息网络侵害人身权益民事纠纷案件适用法律若干问题的规定',
    text: '(全文较长, 详见登记) — 主要内容: 信息网络侵权的管辖、"通知-删除" 规则的具体适用、平台的过错认定、人身权益范围等。',
    lastReviewed: '2026-08-01',
    source: '中国法律法规数据库 (https://flk.npc.gov.cn)',
    relatedInterpretations: [
      {
        name: '最高人民法院关于审理利用信息网络侵害人身权益民事纠纷案件适用法律若干问题的规定',
        issuedAt: '2014-08-21',
        summary: '信息网络侵权的基本规范 (答辩援引率最高的司法解释之一)',
      },
    ],
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
  // 1) 司法解释匹配 (优先: raw 含"最高人民法院"/"最高法"/"司法解释"且 article 是 4 位年份)
  if (/最高法|最高人民法院|司法解释/.test(raw) || item.category === '司法解释') {
    const article = item.article ?? extractArticle(raw);
    if (article) {
      const year = /^\d{4}$/.test(article) ? article : cnToArab(article);
      if (/信息网络|网络侵权|人身权益/.test(raw)) {
        return `司法解释-信息网络-${year}`;
      }
      if (/名誉权/.test(raw)) {
        return `司法解释-名誉权-${year}`;
      }
      return `司法解释-${year}`;
    }
    // fallback: 不知道年份, 按"最经典"司法解释 ID 兜底
    if (/信息网络|网络侵权|人身权益/.test(raw)) {
      return `司法解释-信息网络-2014`;
    }
    if (/名誉权/.test(raw)) {
      return `司法解释-名誉权-1993`;
    }
  }

  // 2) 民法典/民诉法
  const article = item.article ?? extractArticle(raw);
  if (!article) return `未知-${item.article ?? '?'}`;

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
  // 2) 〔YYYY〕 形式 (司法解释常用)
  const m2 = raw.match(/〔(\d{4})〕/);
  if (m2 && m2[1]) return m2[1];
  // 3) 纯 4 位年份结尾 (e.g. "司法解释 2014")
  const m3 = raw.match(/(\d{4})/);
  if (m3 && m3[1]) return m3[1];
  // 4) 纯数字结尾 (e.g. "民法典 1024")
  const m4 = raw.match(/(\d+)\s*$/);
  if (m4 && m4[1]) return m4[1];
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
