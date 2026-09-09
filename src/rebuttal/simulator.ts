/**
 * 攻防推演器 (Counter-Argument Simulator)
 *
 * 模拟原被告双方多轮交锋:
 *   Round 0: 原告起诉状
 *   Round 1: 被告答辩状
 *   Round 2: 原告反驱答辩 (原告律师反击)
 *   Round 3: 被告再答辩
 *   ...
 *
 * 每轮评估:
 *   - 攻击/防御方向
 *   - 风险评分 (0-100, 被告胜诉可能性)
 *   - 关键证据缺口
 *   - 建议下一步
 */

import { callLLM } from '../llm/client.js';
import type { ComplaintAnalysis } from '../analyzer/complaint-types.js';
import type { Case } from '../case/types.js';

export interface Round {
  /** 轮次: 0=起诉, 1=答辩, 2=反驱, 3=再答辩... */
  index: number;
  /** 哪一方: 原告 / 被告 */
  side: '原告' | '被告';
  /** 文书类型: 起诉状/答辩状/反驱答辩状/再答辩状 */
  type: '起诉状' | '答辩状' | '反驱答辩状' | '再答辩状' | '最后陈述';
  /** 本轮主要内容 (markdown) */
  content: string;
  /** 被告胜诉可能性 0-100 (每轮评估) */
  defendantWinProb: number;
  /** 关键攻击点 / 防御点 */
  keyPoints: string[];
  /** 证据缺口 (本轮暴露的) */
  evidenceGaps: string[];
  /** 建议下一步 */
  nextAction: string;
  /** 时间戳 */
  timestamp: string;
}

export interface SimulationResult {
  ok: true;
  mode: 'rule' | 'ai' | 'hybrid';
  /** 案件基本信息 */
  caseContext: { plaintiff: string; defendant: string; cause: string };
  /** 推演轮次 */
  rounds: Round[];
  /** 风险轨迹 (每轮的被告胜诉概率) */
  trajectory: number[];
  /** 趋势: improving (胜诉概率↑) / stable / worsening (↓) */
  trend: 'improving' | 'stable' | 'worsening';
  /** 关键转折点 (哪个 round 风险变化最大) */
  pivotRound?: number;
  /** 整体建议 */
  overallAdvice: string;
  /** 推演时间 */
  simulatedAt: string;
}

export interface SimulateOptions {
  /** 案件 */
  case: Case;
  /** 拆解结果 */
  analysis: ComplaintAnalysis;
  /** 被告答辩状内容 */
  defense: string;
  /** 推演轮数 (默认 3: 反驱 + 再答辩 + 最后陈述) */
  rounds?: number;
  /** 模式 */
  mode?: 'rule' | 'ai' | 'hybrid';
  /** LLM provider */
  provider?: 'deepseek' | 'minimax';
}

/**
 * 推演入口
 */
export async function simulateBattle(opts: SimulateOptions): Promise<SimulationResult> {
  const mode = opts.mode ?? 'rule';
  const parsedRounds = Number(opts.rounds);
  const targetRounds = Number.isInteger(parsedRounds) && parsedRounds >= 1 ? parsedRounds : 3;

  const trajectory: number[] = [100]; // Round 0: 起诉, 被告胜诉概率初始化为 100 (未开始抗辩)
  const allRounds: Round[] = [];

  // Round 0: 起诉状
  allRounds.push({
    index: 0,
    side: '原告',
    type: '起诉状',
    content: `案件: ${opts.case.title}\n原告: ${opts.analysis.parties.原告.name}\n被告: ${opts.case.defendant.name}\n诉请数: ${opts.analysis.claims.length}\n法条数: ${opts.analysis.legalBasisItems.length}`,
    defendantWinProb: 100, // 被告未答辩, 默认胜诉 (因为未被反驳)
    keyPoints: opts.analysis.claims.map((c) => `诉请 ${c.index}: ${c.content.slice(0, 30)}`),
    evidenceGaps: ['未知 (被告尚未提交答辩状)'],
    nextAction: '提交答辩状',
    timestamp: new Date().toISOString(),
  });

  // Round 1: 被告答辩状
  const round1Score = scoreDefense(opts.defense, opts.analysis, opts.case);
  trajectory.push(round1Score.score);
  allRounds.push({
    index: 1,
    side: '被告',
    type: '答辩状',
    content: opts.defense,
    defendantWinProb: round1Score.score,
    keyPoints: round1Score.keyPoints,
    evidenceGaps: round1Score.evidenceGaps,
    nextAction: round1Score.nextAction,
    timestamp: new Date().toISOString(),
  });

  // Round 2+: 推演 (rule 或 AI)
  for (let r = 2; r <= targetRounds; r++) {
    const prev = allRounds[allRounds.length - 1]!;
    const nextSide: '原告' | '被告' = prev.side === '原告' ? '被告' : '原告';
    const nextType: Round['type'] = r === 2 ? '反驱答辩状' : r === targetRounds ? '最后陈述' : prev.side === '原告' ? '再答辩状' : '反驱答辩状';

    let round: Round;
    if (mode === 'rule') {
      round = ruleBasedSimulate(r, nextSide, nextType, prev, opts);
    } else {
      const aiRound = await aiBasedSimulate(r, nextSide, nextType, prev, opts);
      round = aiRound ?? ruleBasedSimulate(r, nextSide, nextType, prev, opts);
    }

    allRounds.push(round);
    trajectory.push(round.defendantWinProb);
  }

  // 趋势/转折: 从 Round 1 (被告实际答辩) 起算, 排除 Round 0 的 100 分伪基线
  const scored = trajectory.slice(1);
  const trend = computeTrend(scored);
  const pivotIdx = findPivot(scored);
  const pivotRound = pivotIdx === undefined ? undefined : pivotIdx + 1;
  const overallAdvice = generateAdvice(allRounds, trend, pivotRound, opts);

  return {
    ok: true,
    mode,
    caseContext: {
      plaintiff: opts.analysis.parties.原告.name,
      defendant: opts.case.defendant.name,
      cause: opts.analysis.cause,
    },
    rounds: allRounds,
    trajectory,
    trend,
    pivotRound,
    overallAdvice,
    simulatedAt: new Date().toISOString(),
  };
}

/**
 * 评估被告答辩状强度 (Round 1)
 */
function scoreDefense(defense: string, analysis: ComplaintAnalysis, _c: Case): {
  score: number;
  keyPoints: string[];
  evidenceGaps: string[];
  nextAction: string;
} {
  let score = 50; // 基础分
  const keyPoints: string[] = [];
  const evidenceGaps: string[] = [];

  // 程序性反点存在 +++
  if (/超过诉讼时效|诉讼时效|3 年|三年/.test(defense)) {
    score += 25;
    keyPoints.push('采用诉讼时效抗辩 (一票否决性, 高胜算)');
  }
  if (/管辖异议|受案法院.*无管辖权|移送.*法院/.test(defense)) {
    score += 15;
    keyPoints.push('采用管辖异议');
  }
  if (/被告主体不适格|适格被告|雇主责任/.test(defense)) {
    score += 15;
    keyPoints.push('采用主体不适格抗辩');
  }

  // 实体反点 +5/+10
  if (/舆论监督|1025|合理核实义务/.test(defense)) {
    score += 10;
    keyPoints.push('采用舆论监督免责 (民法典 1025)');
  }
  if (/未达名誉权侵害|1024|不构成/.test(defense)) {
    score += 5;
    keyPoints.push('采用未达侵权程度抗辩');
  }
  if (/无损害后果|未举证|举证不能/.test(defense)) {
    score += 8;
    keyPoints.push('采用无损害后果抗辩');
  }
  if (/未实施被诉行为|账号.*?并非|不能证明.*?发布/.test(defense)) {
    score += 8;
    keyPoints.push('采用未实施被诉行为抗辩');
  }

  // 占位符未填 -10/-20
  const placeholders = (defense.match(/\[待补充[^\]]*\]|\[(来源|账号|核实|平台|具体)[^\]]{0,30}\]/g) ?? []).length;
  if (placeholders > 0) {
    score -= Math.min(20, placeholders * 3);
    evidenceGaps.push(`${placeholders} 个 [待补充] 占位符未填 (高风险)`);
  }

  // 答辩状过短 -10
  if (defense.length < 1500) {
    score -= 10;
    evidenceGaps.push('答辩状过短 (< 1500 字), 事实部分模糊');
  }

  // 类案参考 +5
  if (/类案参考|裁判要点/.test(defense)) {
    score += 5;
    keyPoints.push('含类案参考');
  } else {
    evidenceGaps.push('缺类案参考');
  }

  // 证据清单 +5
  if (/答辩证据|证据清单|证据指引/.test(defense)) {
    score += 5;
    keyPoints.push('含证据清单/指引');
  } else {
    evidenceGaps.push('缺证据清单/指引');
  }

  // 诉请未回应
  for (const claim of analysis.claims) {
    if (!defense.includes(`诉请 ${claim.index}：`)) {
      score -= 5;
      evidenceGaps.push(`诉请 ${claim.index} 未回应`);
    }
  }

  score = Math.max(0, Math.min(100, score));

  // 决定下一步
  let nextAction = '保持当前策略, 准备庭审';
  if (placeholders > 3) {
    nextAction = '⚠️ 立即填充 [待补充] 占位符, 否则原告律师将攻击答辩状空洞';
  } else if (score < 50) {
    nextAction = '⚠️ 整体策略需调整, 建议补充反点或加强证据';
  } else if (score < 70) {
    nextAction = '中等强度, 重点补充 [待补充] 和证据清单';
  }

  return { score, keyPoints, evidenceGaps, nextAction };
}

/**
 * Rule 模式推演 — 模拟原/被告律师,根据前一轮 + 案件事实生成下轮
 */
function ruleBasedSimulate(
  roundIdx: number,
  side: '原告' | '被告',
  type: Round['type'],
  prev: Round,
  _opts: SimulateOptions,
): Round {
  const lastScore = prev.defendantWinProb;

  // 推演趋势: 双方攻防, 被告胜诉概率会震荡
  let newScore = lastScore;
  if (side === '原告') {
    // 原告反驱: 通常削弱被告 5-15 分
    newScore = Math.max(0, lastScore - 8);
  } else {
    // 被告再答辩: 强化 3-10 分
    newScore = Math.min(100, lastScore + 5);
  }

  // 根据 round 和 type 决定内容
  const keyPoints: string[] = [];
  const evidenceGaps: string[] = [];

  if (side === '原告' && type === '反驱答辩状') {
    keyPoints.push('原告律师: 答辩状中 X 处无证据支持, 系空洞抗辩');
    keyPoints.push('原告律师: 即使采用某反点, 也无法解释 Y 行为');
    evidenceGaps.push('被告应在下一轮补充 Z 证据');
  } else if (side === '被告' && type === '再答辩状') {
    keyPoints.push('被告律师: 原告反驱回避了核心反点, 进一步论证');
    keyPoints.push('被告律师: 补充 [新证据] 强化 [反点]');
    evidenceGaps.push('可能需要证人出庭或申请调查令');
  } else if (type === '最后陈述') {
    keyPoints.push('最后陈述: 总结核心反点 + 请求法院采纳');
  }

  const nextAction = side === '原告'
    ? '被告应准备应对 [新反驱], 强化证据'
    : '等待原告下一步, 准备庭审';

  return {
    index: roundIdx,
    side,
    type,
    content: `[Rule 推演] ${side} 第 ${roundIdx} 轮: ${type}\n\n(基于前一轮: 被告胜诉概率 ${lastScore}%, 证据缺口: ${prev.evidenceGaps.length} 个)\n\n推演内容: ${keyPoints.join('; ')}`,
    defendantWinProb: newScore,
    keyPoints,
    evidenceGaps,
    nextAction,
    timestamp: new Date().toISOString(),
  };
}

/**
 * AI 模式推演 — 调 LLM 模拟原/被告律师
 */
async function aiBasedSimulate(
  roundIdx: number,
  side: '原告' | '被告',
  type: Round['type'],
  prev: Round,
  opts: SimulateOptions,
): Promise<Round | null> {
  const system = `你是一名中国民事诉讼律师, 此刻**${side === '原告' ? '代理原告' : '代理被告'}**, 正在写**${type}**。

任务: 基于前一轮内容 + 案件事实, 生成**真实、犀利、有法律依据**的本轮文书要点, 并评估对${side === '原告' ? '原告' : '被告'}的影响。

**输出格式 (严格 JSON)**:
- content: 100-300 字的文书内容草稿
- defendantWinProb: 0-100, **被告**胜诉可能性评估 (无论你在为哪一方起草, 该字段始终指被告的胜诉概率)
- keyPoints: 3-5 个核心要点
- evidenceGaps: 1-3 个证据缺口
- nextAction: 建议下一步`;

  const user = `## 案件背景

${JSON.stringify({ case: opts.case, analysis: opts.analysis }, null, 2)}

## 前一轮 (${prev.type}, 被告胜诉概率 ${prev.defendantWinProb}%)

${prev.content}

## 你的任务

作为${side}, 写本轮 (${type}) 的草稿 + 评估. 只输出 JSON.`;

  const result = await callLLM(
    [{ role: 'system', content: system }, { role: 'user', content: user }],
    {
      provider: opts.provider,
      temperature: 0.6,
      maxTokens: 2000,
    },
  );

  if (!result.ok) return null;

  // 解析 JSON
  const arr = extractJson(result.text);
  if (!arr || typeof arr !== 'object') return null;
  const o = arr as Record<string, unknown>;

  return {
    index: roundIdx,
    side,
    type,
    content: String(o['content'] ?? ''),
    defendantWinProb: typeof o['defendantWinProb'] === 'number' ? Math.max(0, Math.min(100, o['defendantWinProb'])) : 50,
    keyPoints: Array.isArray(o['keyPoints']) ? o['keyPoints'].map(String) : [],
    evidenceGaps: Array.isArray(o['evidenceGaps']) ? o['evidenceGaps'].map(String) : [],
    nextAction: String(o['nextAction'] ?? ''),
    timestamp: new Date().toISOString(),
  };
}

function extractJson(text: string): unknown {
  const m = text.match(/```(?:json)?\s*\n?([\s\S]+?)\n?```/);
  const jsonText = m && m[1] ? m[1] : text;
  const first = jsonText.indexOf('{');
  const last = jsonText.lastIndexOf('}');
  if (first < 0 || last < 0) return null;
  try {
    return JSON.parse(jsonText.slice(first, last + 1));
  } catch {
    return null;
  }
}

function computeTrend(traj: number[]): 'improving' | 'stable' | 'worsening' {
  if (traj.length < 2) return 'stable';
  const first = traj[0]!;
  const last = traj[traj.length - 1]!;
  const diff = last - first;
  if (diff > 10) return 'improving';
  if (diff < -10) return 'worsening';
  return 'stable';
}

function findPivot(traj: number[]): number | undefined {
  if (traj.length < 3) return undefined;
  let maxDiff = 0;
  let pivot = 0;
  for (let i = 1; i < traj.length; i++) {
    const diff = Math.abs(traj[i]! - traj[i - 1]!);
    if (diff > maxDiff) {
      maxDiff = diff;
      pivot = i;
    }
  }
  return maxDiff >= 15 ? pivot : undefined;
}

function generateAdvice(rounds: Round[], trend: 'improving' | 'stable' | 'worsening', pivot: number | undefined, _opts: SimulateOptions): string {
  const final = rounds[rounds.length - 1];
  if (!final) return '推演未完成';

  const lastScore = final.defendantWinProb;
  const tips: string[] = [];

  if (lastScore >= 80) {
    tips.push(`✅ 被告胜诉概率高 (${lastScore}%), 准备充分, 建议维持现状并准备庭审`);
  } else if (lastScore >= 60) {
    tips.push(`🟡 被告胜诉概率中等 (${lastScore}%), 有改进空间, 重点关注 ${final.evidenceGaps.length} 个证据缺口`);
  } else if (lastScore >= 40) {
    tips.push(`🟠 被告胜诉概率偏低 (${lastScore}%), 建议补强关键反点 + 补充关键证据`);
  } else {
    tips.push(`🔴 被告胜诉概率低 (${lastScore}%), 强烈建议调解或重新评估诉讼策略`);
  }

  if (trend === 'worsening') {
    tips.push('⚠️ 趋势恶化: 原告反驱有效, 建议在 [最后一轮] 重点强化');
  } else if (trend === 'improving') {
    tips.push('📈 趋势改善: 被告策略有效, 继续保持');
  }

  if (pivot) {
    const pivotRound = rounds[pivot];
    tips.push(`🔄 关键转折在 Round ${pivot} (${pivotRound?.type}): ${pivotRound?.keyPoints[0] ?? ''}`);
  }

  tips.push(`💼 实际诉讼建议: 重大/复杂案件请委托执业律师, 本工具仅作参考`);

  return tips.join('\n');
}
