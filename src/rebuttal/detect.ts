/**
 * 反点命中检测 — self-check (统计已用/漏用反点) 与 simulator (按反点给答辩状评分)
 * 共用的唯一口径, 避免两处正则漂移。
 */
import type { StrategyId } from './strategies-base.js';
import { STRATEGIES } from './strategies.js';

export const ALL_STRATEGY_IDS = Object.keys(STRATEGIES) as StrategyId[];

/**
 * 反点的常见行文别名。刻意收紧: 不抓裸数字条号 ("第1024条") 或泛词 ("不构成"),
 * 否则任何引用法条的答辩状都会被判为"已采用"该反点。
 */
const ALIASES: Record<StrategyId, RegExp> = {
  'fact-true': /舆论监督|合理核实义务/,
  'no-act': /未实施被诉行为|不能证明.{0,20}发布|账号.{0,20}并非/,
  'no-tort-grade': /未达.{0,6}侵害|不构成(名誉权)?侵害/,
  'no-damage': /无损害后果|未举证|举证不能/,
  'no-causation': /无因果关系|因果关系不成立/,
  'statute-limitations': /诉讼时效/,
  'jurisdiction': /管辖(权)?异议|无管辖权|移送.{0,10}法院/,
  'wrong-party': /被告主体不适格|不适格被告|雇主责任/,
};

/** 答辩状中命中的反点 (策略名原文出现, 或出现行文别名) */
export function detectUsedStrategies(defense: string): StrategyId[] {
  return ALL_STRATEGY_IDS.filter(
    (id) => defense.includes(STRATEGIES[id].name) || ALIASES[id].test(defense),
  );
}

/** 答辩状是否逐条回应了第 N 项诉请 ("诉请 N:" / "诉请 N：") */
export function respondsToClaim(defense: string, claimIndex: number): boolean {
  return new RegExp(`诉请\\s*${claimIndex}\\s*[：:]`).test(defense);
}
