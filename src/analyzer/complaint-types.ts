/**
 * 原告起诉状拆解结果 — 4 维结构化模型
 *
 * 拆解目的: 让答辩方能"逐条打掉"原告诉请, 而不是泛泛否认。
 *
 * 四维:
 *   1. 主体 (parties)      — 谁告谁
 *   2. 诉请 (claims)       — 要什么
 *   3. 事实 (facts)        — 凭什么
 *   4. 法律依据 (legalBasis) — 靠什么
 *
 * 加上 关键要素评分 + 反驳优先级 = 答辩生成的输入。
 */

import type { Case } from '../case/types.js';

/** 4 个核心要件的命中度评估 */
export type FactAuthenticity = 'likely_true' | 'disputed' | 'likely_false' | 'unknown';
export type Directedness = 'high' | 'medium' | 'low'; // 内容能否识别原告
export type Fault = 'intentional' | 'negligent' | 'unknown';
export type Damage = 'strong' | 'weak' | 'none_proven';

/** 单条诉请 */
export interface ParsedClaim {
  /** 编号: 1, 2, 3 ... */
  index: number;
  /** 诉请原文 (精简) */
  content: string;
  /** 性质分类: 停止侵害 / 恢复名誉 / 赔偿损失 / 精神损害 / 诉讼费 */
  type: 'stop_infringement' | 'restore_reputation' | 'compensate_loss' | 'spiritual_compensation' | 'litigation_cost' | 'other';
  /** 金额 (元), 适用赔偿类诉请 */
  amount?: number;
}

export interface ParsedParty {
  name: string;
  role: '原告' | '被告' | '律师' | '代理人';
  idNumber?: string;
  address?: string;
  contact?: string;
}

export interface ParsedEvidence {
  /** 编号 */
  index: number;
  /** 名称 */
  name: string;
  /** 证据种类 */
  kind: string;
  /** 证明目的 */
  purpose: string;
}

export interface ParsedFacts {
  /** 侵权方式: 微博/抖音/文章/口头等 */
  tortMethod: string;
  /** 侵权内容原文/概括 */
  tortContent: string;
  /** 传播范围/影响 */
  spread: string;
  /** 侵权时间 */
  time?: string;
  /** 侵权地点/平台 */
  place?: string;
}

export interface ElementScore {
  /** 事实真实性评估 */
  factAuthenticity: FactAuthenticity;
  /** 内容指向性 (能否识别原告) */
  directedness: Directedness;
  /** 主观过错评估 */
  fault: Fault;
  /** 损害后果充分性 */
  damage: Damage;
}

export interface CaseReference {
  /** 类案要点 (不编案号) */
  title: string;
  /** 裁判要点/规则 */
  holding: string;
  /** 适用情形说明 */
  applicableWhen: string;
}

/** 拆解完整结果 */
export interface ComplaintAnalysis {
  /** 拆解来源 (起诉状文件路径) */
  source: string;
  /** 拆解时间 */
  analyzedAt: string;
  /** 拆解模式: ai (LLM 驱动) / draft (关键词抽取) */
  mode: 'ai' | 'draft';
  /** 主体 */
  parties: { 原告: ParsedParty; 被告: ParsedParty; 律师?: ParsedParty };
  /** 案由 */
  cause: string;
  /** 诉请 */
  claims: ParsedClaim[];
  /** 事实 */
  facts: ParsedFacts;
  /** 证据 */
  evidence: ParsedEvidence[];
  /** 法律依据 */
  legalBasis: string[];
  /** 4 要件评分 (用于反驳策略选择) */
  elementScore: ElementScore;
  /** 诉请反驳优先级 (claim index 列表, 从高到低) */
  rebuttalPriority: number[];
  /** 整体置信度 0-1, 拆解可信度自评 */
  confidence: number;
  /** 拆解备注 / 警告 */
  warnings: string[];
  /** 类案参考 (Step 2 填入) */
  caseReferences?: CaseReference[];
}

/** 拆解选项 */
export interface AnalyzeOptions {
  /** LLM provider override */
  provider?: 'deepseek' | 'minimax';
  /** 纯模板 (不调 LLM, 用正则/关键词) */
  draft?: boolean;
  /** 额外指令 (给 LLM) */
  extraInstruction?: string;
}

/** 拆解结果 (含错误) */
export type AnalyzeResult =
  | { ok: true; analysis: ComplaintAnalysis }
  | { ok: false; error: string; code: 'parse_error' | 'llm_error' | 'invalid_format'; partialDraft?: ComplaintAnalysis };
