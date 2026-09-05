/**
 * 反驳策略库 — 5 个核心实体反点 (实体性)
 *
 * 程序性反点 (诉讼时效/管辖/主体不适格) 单独在 procedural.ts,
 * 因为它们"一票否决"性质, 优先于实体反点。
 *
 * 5 个核心实体反点:
 *   1. fact-true         事实基本属实 / 舆论监督免责 (1025 条)
 *   2. no-act            未实施被诉行为
 *   3. no-tort-grade     未达名誉权侵害程度
 *   4. no-damage         无损害后果
 *   5. no-causation      无因果关系
 *
 * 每个反点包含:
 *   - 适用情形 (适用度评分 0-1)
 *   - 通用措辞模板
 *   - 需要补充的证据清单
 *   - 类案参考 (要点式, 不编案号)
 *   - 引用法条
 */

import type { ComplaintAnalysis, ParsedClaim } from '../analyzer/complaint-types.js';
import type { RebuttalStrategy, StrategyId } from './strategies-base.js';
import { PROCEDURAL_STRATEGIES, PROCEDURAL_IDS } from './procedural.js';

export { PROCEDURAL_STRATEGIES, PROCEDURAL_IDS };
export type { RebuttalStrategy, StrategyId };

export const STRATEGIES: Record<StrategyId, RebuttalStrategy> = {
  ...PROCEDURAL_STRATEGIES,

  // ============================================
  // 反点 1: 事实基本属实 / 舆论监督免责
  // ============================================
  'fact-true': {
    id: 'fact-true',
    name: '事实基本属实 / 舆论监督免责',
    description:
      '被告所述内容有合理信息来源或已尽到合理核实义务, 不构成捏造/歪曲事实, 依法属于舆论监督的免责情形',
    applicability: (a) => {
      if (a.elementScore.factAuthenticity === 'likely_true') return 0.95;
      if (a.elementScore.factAuthenticity === 'disputed') return 0.6;
      if (/公益|社会|行业|公共|大众|消费者|群众|人民/.test(a.facts.tortContent)) return 0.5;
      return 0.2;
    },
    template: `被告的言论**有合理的事实依据**, 属于依法**实施新闻报道、舆论监督等公共利益相关行为**。

依据《中华人民共和国民法典》第一千零二十五条: "行为人为公共利益实施新闻报道、舆论监督等行为, 影响他人名誉的, 不承担民事责任, 但有下列情形之一的除外: (一) 捏造、歪曲事实; (二) 对他人提供的严重失实内容未尽到合理核实义务。"

被告**不存在上述两种情形**:

1. **未捏造、歪曲事实**。被告所述内容均有 [信息来源] 支持, 与客观事实基本一致;
2. **已尽到合理核实义务**。被告在发布前已通过 [核实手段] 对所述内容进行了核实。

故被告行为属于法定的**舆论监督免责情形**, 依法不应承担民事责任。`,
    evidenceToGather: [
      '信息来源的原始材料 (政府公开文件、判决书、新闻报道、学术论文等)',
      '被告发布前进行核实的证据 (邮件往来、采访录音、采访记录等)',
      '权威第三方对该事实的认定 (行业协会、专业机构等)',
    ],
    legalBasis: '《中华人民共和国民法典》第一千零二十五条',
    caseRefs: [
      {
        title: '舆论监督涉及产品质量的批评',
        holding:
          '消费者或媒体对生产者、销售者的产品质量或服务进行批评、评论, 反映的问题基本属实的, 不应认定为侵害名誉权。',
        applicableWhen: '被告所述内容涉及原告产品/服务/行业行为, 且有合理依据。',
      },
      {
        title: '新闻媒体对公共事件的报道',
        holding:
          '新闻媒体就社会关注度高的公共事件进行报道, 内容来源于官方公开信息或权威报道, 即使个别细节存在争议, 也不应认定为捏造事实。',
        applicableWhen: '被告所述内容来源于公开报道、官方通报、司法文书等。',
      },
      {
        title: '公民对不文明行为的批评',
        holding:
          '公民对他人违反公序良俗的不文明行为进行适度批评, 属于社会监督的合理范畴, 法律应予保护。',
        applicableWhen: '被告所述内容属于对原告不文明行为的批评, 未超出合理限度。',
      },
    ],
  },

  // ============================================
  // 反点 2: 未实施被诉行为
  // ============================================
  'no-act': {
    id: 'no-act',
    name: '未实施被诉行为',
    description:
      '被诉侵权行为并非被告所为 — 账号非被告所有/内容非被告发布/转帖非被告原创等',
    applicability: (a) => {
      if (a.confidence < 0.4) return 0.7;
      if (a.facts.tortMethod === '（未识别）') return 0.6;
      if (/匿名|网名|账号|昵称|@/.test(a.facts.tortContent)) return 0.4;
      return 0.2;
    },
    template: `被告**未实施**原告所诉的侵权行为。

1. **账号归属存疑**。原告所指控的涉案账号 [账号 ID] 并非被告注册/所有/使用。原告未能举证证明该账号与被告存在直接关联;
2. **内容非被告发布**。即使涉案账号与被告存在关联, 涉案内容亦非被告本人发布, 可能存在 [账号被盗/他人冒用/系统自动推送] 等情形;
3. **被告不存在主观过错**。被告主观上既无侮辱原告的故意, 亦无诽谤原告的过失。

依据《中华人民共和国民事诉讼法》第六十七条 "谁主张谁举证" 的基本原则, 原告对被告实施了被诉行为负有举证责任。在原告未能充分举证的情况下, 应当承担举证不能的不利后果。`,
    evidenceToGather: [
      '涉案账号的实名认证信息 (如平台可提供)',
      '被告本人的所有平台账号清单 (证明涉案账号不在其中)',
      '账号被盗/冒用的证据 (报警回执、平台申诉记录等)',
      '涉案内容的发布设备/IP/时间戳证据',
    ],
    legalBasis: '《中华人民共和国民事诉讼法》第六十七条 (举证责任)',
    caseRefs: [
      {
        title: '匿名网络账号身份认定',
        holding:
          '原告主张匿名网络账号发布的内容侵害其名誉权, 应当举证证明该账号的实际使用人即为被告。仅凭内容相似性或主观臆断不足以认定。',
        applicableWhen: '涉案内容发布于匿名/网名账号, 原告未能证明账号归属。',
      },
      {
        title: '转发行为的责任界定',
        holding:
          '对他人已发布内容的单纯转发, 转发者通常不承担主要侵权责任, 除非转发时附加了侮辱性评论或明知内容不实仍予扩散。',
        applicableWhen: '被告仅是转发者, 未对内容进行实质性修改或添加侮辱性评论。',
      },
    ],
  },

  // ============================================
  // 反点 3: 未达名誉权侵害程度
  // ============================================
  'no-tort-grade': {
    id: 'no-tort-grade',
    name: '未达名誉权侵害程度',
    description:
      '涉案内容未指名道姓/无法识别原告/属合理公共讨论/未达侮辱诽谤程度, 不构成名誉权侵害',
    applicability: (a) => {
      if (a.elementScore.directedness === 'low') return 0.85;
      if (a.elementScore.directedness === 'medium') return 0.5;
      if (/泛指|某些人|部分人|个别/.test(a.facts.tortContent)) return 0.6;
      return 0.2;
    },
    template: `涉案内容**不构成对原告名誉权的侵害**, 具体理由如下:

1. **涉案内容未明确指向原告**。被告所述内容中**未提及原告姓名、身份、肖像或其他可识别信息**, 公众无法从该内容中识别出原告属于特定主体。依据《民法典》第一千零二十四条, 名誉权侵害的成立以"特定主体"可识别为前提, 不能识别的内容不构成对特定人名誉权的侵害。

2. **涉案内容属于合理的公共讨论**。即使部分读者可能联想到原告, 涉案内容亦属于就 [行业现象/公共议题] 进行的**正当评论与讨论**, 属于公民行使言论自由权的合法范畴。

3. **涉案内容未达侮辱、诽谤的严重程度**。"侮辱"是指以暴力或其他方式公然贬损他人人格; "诽谤"是指捏造并散布虚构的事实。被告所述内容**既无虚构事实, 也无明显贬损措辞**, 难以认定达到名誉权侵害的严重程度。`,
    evidenceToGather: [
      '涉案内容的原始文本 (完整, 含上下文)',
      '涉案内容发布平台的匿名性证明 (未实名认证)',
      '专家/学者对涉案内容性质的法律意见书',
      '对涉案内容是否可识别原告的受众调查 (如有)',
    ],
    legalBasis: '《中华人民共和国民法典》第一千零二十四条',
    caseRefs: [
      {
        title: '未指名的批评不构成名誉权侵害',
        holding:
          '批评文章未提及被批评者的真实姓名, 仅描述其行业特征, 一般公众无法识别出特定人的, 不构成对该特定人名誉权的侵害。',
        applicableWhen: '涉案内容未直接提及原告姓名/身份, 原告主张通过描述特征识别。',
      },
      {
        title: '合理评论与侮辱的界限',
        holding:
          '评论人基于公共利益对特定行业现象进行批评, 使用的语言虽有一定尖锐性, 但未超出合理评论的范畴, 不应认定为侮辱。',
        applicableWhen: '被告的评论属对行业现象的批评, 用语虽有尖锐但未超出合理限度。',
      },
    ],
  },

  // ============================================
  // 反点 4: 无损害后果
  // ============================================
  'no-damage': {
    id: 'no-damage',
    name: '无损害后果',
    description: '原告未能举证证明实际损害 (财产损失/精神损害) 的存在, 诉请缺乏事实依据',
    applicability: (a) => {
      if (a.elementScore.damage === 'none_proven') return 0.9;
      if (a.elementScore.damage === 'weak') return 0.7;
      if (a.elementScore.damage === 'strong') return 0.2;
      return 0.5;
    },
    template: `原告**未能举证证明实际损害后果的存在**, 其损害赔偿请求缺乏事实依据。

依据《最高人民法院关于民事诉讼证据的若干规定》第二条 "当事人对自己提出的诉讼请求所依据的事实或者反驳对方诉讼请求所依据的事实有责任提供证据加以证明"。

1. **关于合理费用**: 原告主张的律师费、公证费、差旅费等合理费用, 应当提供: (1) 律师费发票及委托代理合同; (2) 公证书及公证费发票; (3) 差旅费票据。原告**未能提供充分票据**的, 该项请求不应得到支持。

2. **关于精神损害抚慰金**: 依据《民法典》第一千一百八十三条, 精神损害赔偿的成立以"严重精神损害"为前提。原告**仅主张精神损害, 但未能提供医疗机构诊断证明、心理评估报告等证据**证明达到"严重"程度, 该项请求不应得到支持。

3. **关于"实际损失"**: 名誉权侵害中的财产损失以"实际发生"为限。原告未能证明涉案内容直接导致其收入减少/合同解除/客户流失等具体损失, 该项请求亦不应支持。`,
    evidenceToGather: [
      '原告主张的合理费用票据 (审查真实性、关联性)',
      '原告的财务记录 (证明未实际发生损失)',
      '原告与第三方合同关系 (证明未受影响)',
    ],
    legalBasis: '《中华人民共和国民法典》第一千一百八十三条; 《民事诉讼证据规定》第二条',
    caseRefs: [
      {
        title: '精神损害赔偿的"严重"标准',
        holding:
          '名誉权侵害中的精神损害赔偿, 应当以"严重精神损害"为前提。仅凭原告单方陈述, 无医学诊断或心理评估佐证的, 不应认定达到"严重"程度。',
        applicableWhen: '原告主张精神损害抚慰金, 但未提供医学/心理学证据。',
      },
      {
        title: '合理费用的举证',
        holding:
          '维权合理费用应当以实际发生的、有正式票据的费用为限。律师费未提供委托代理合同和发票的, 不予支持。',
        applicableWhen: '原告主张的律师费/公证费缺乏票据支持。',
      },
    ],
  },

  // ============================================
  // 反点 5: 无因果关系
  // ============================================
  'no-causation': {
    id: 'no-causation',
    name: '无因果关系',
    description:
      '原告主张的损害后果与被告行为之间不存在直接因果关系, 损害系其他原因 (原告自身原因/第三人行为/既往负面评价等) 所致',
    applicability: (a) => {
      if (a.elementScore.damage === 'none_proven') return 0.6;
      if (/曾|之前|既往|此前|早已/.test(a.facts.tortContent)) return 0.5;
      return 0.3;
    },
    template: `原告主张的损害后果与被告行为之间**不存在法律上的因果关系**。

1. **损害系原告自身原因所致**。原告所述的 [社会评价降低/经济损失/精神痛苦] 等后果, 主要源于 [原告自身的行为/原告既往的负面评价/行业大环境变化] 等因素, 与被告的涉案内容**无直接关联**。

2. **损害系第三人行为所致**。即使存在损害, 该损害亦可能源于 [其他媒体的类似报道/网络自发性传播/原告自身公开的信息披露] 等第三人或公开渠道, 而非被告单独所致。

3. **时间上无紧密关联**。被告发布内容的时间与原告所述损害发生的时间**间隔 [时长]**, 不符合名誉权侵害因果关系"时间紧密性"的要求。

依据《民法典》第一千零二十四条, 名誉权侵害的成立要求违法行为与损害后果之间存在直接因果关系。在原告未能证明直接因果关系的情况下, 其请求不应得到支持。`,
    evidenceToGather: [
      '原告既往的负面新闻/评价 (证明社会评价本就如此)',
      '原告自身行为/公告 (证明损害系自因)',
      '其他传播者清单 (证明损害非被告单独所致)',
    ],
    legalBasis: '《中华人民共和国民法典》第一千零二十四条',
    caseRefs: [
      {
        title: '多因一果下的因果关系认定',
        holding:
          '损害后果系多种原因共同导致时, 原告应当举证证明被告的行为是损害发生的"直接原因"或"主要原因"。仅证明被告行为与损害同时存在不足以认定因果关系。',
        applicableWhen: '存在多个可能的原因, 原告未能证明被告行为是主要原因。',
      },
      {
        title: '损害发生时间的关联性',
        holding:
          '原告主张的损害 (如合同解除、客户流失等) 发生时间与被告发布内容时间间隔过长的, 难以认定存在直接因果关系。',
        applicableWhen: '损害发生时间与被告发布内容时间间隔较长, 或中间存在其他原因。',
      },
    ],
  },
};

/**
 * 策略选择器 — 根据拆解结果选最合适的 1-3 个反点
 */
export function selectStrategies(analysis: ComplaintAnalysis, topN: number = 3): RebuttalStrategy[] {
  const scored = Object.values(STRATEGIES)
    .map((s) => ({ strategy: s, score: s.applicability(analysis) }))
    .filter((x) => x.score >= 0.3)
    .sort((a, b) => b.score - a.score);

  if (scored.length === 0) {
    return [STRATEGIES['no-damage']];
  }

  return scored.slice(0, topN).map((x) => x.strategy);
}

/**
 * 针对单条诉请, 选出最合适的反点
 *
 * 关键逻辑: 程序性反点 (一票否决性) 适用度 >= 0.6 时, 强制选择
 */
export function selectStrategyForClaim(claim: ParsedClaim, analysis: ComplaintAnalysis): RebuttalStrategy {
  // 程序性反点一票否决
  for (const id of PROCEDURAL_IDS) {
    const s = STRATEGIES[id];
    if (s.applicability(analysis) >= 0.6) {
      return s;
    }
  }

  // 诉请类型 → 优先实体反点
  const priorityMap: Record<ParsedClaim['type'], StrategyId[]> = {
    stop_infringement: ['no-act', 'no-tort-grade', 'fact-true'],
    restore_reputation: ['no-act', 'no-tort-grade', 'fact-true'],
    compensate_loss: ['no-damage', 'no-causation'],
    spiritual_compensation: ['no-damage', 'no-causation'],
    litigation_cost: ['no-damage'],
    other: ['no-tort-grade', 'fact-true', 'no-damage'],
  };

  const priorities = priorityMap[claim.type] ?? ['no-tort-grade', 'no-damage', 'fact-true'];

  for (const id of priorities) {
    const s = STRATEGIES[id];
    if (s.applicability(analysis) >= 0.3) {
      return s;
    }
  }
  return STRATEGIES['no-damage'];
}
