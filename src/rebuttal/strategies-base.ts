/**
 * 反驳策略类型定义 (独立文件, 便于 procedural.ts 依赖)
 */
import type { ComplaintAnalysis } from '../analyzer/complaint-types.js';

export type Applicability = number;

export interface CaseRef {
  title: string;
  holding: string;
  applicableWhen: string;
}

export interface RebuttalStrategy {
  id: StrategyId;
  name: string;
  description: string;
  applicability: (a: ComplaintAnalysis) => Applicability;
  template: string;
  evidenceToGather: string[];
  legalBasis: string;
  caseRefs: CaseRef[];
}

export type StrategyId =
  | 'fact-true'
  | 'no-act'
  | 'no-tort-grade'
  | 'no-damage'
  | 'no-causation'
  | 'statute-limitations'
  | 'jurisdiction'
  | 'wrong-party';
