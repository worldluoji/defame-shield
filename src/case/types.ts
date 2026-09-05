/**
 * 案件数据结构 — 一个案件 = 一个目录 + case.json + 证据清单
 */
export interface Party {
  /** 自然人姓名 或 法人/组织名称 */
  name: string;
  /** 身份: 原告/被告/律师/代理人 */
  role: '原告' | '被告' | '律师' | '代理人';
  /** 联系方式 (选填) */
  contact?: string;
  /** 身份证号 / 统一社会信用代码 (选填, 存证用) */
  idNumber?: string;
  /** 地址 (诉讼文书送达地址) */
  address?: string;
}

export interface Evidence {
  /** 编号: 证据 1, 证据 2 ... */
  index: number;
  /** 名称 */
  name: string;
  /** 种类: 书证/物证/视听资料/电子数据/证人证言/鉴定意见/勘验笔录 */
  kind:
    | '书证'
    | '物证'
    | '视听资料'
    | '电子数据'
    | '证人证言'
    | '鉴定意见'
    | '勘验笔录';
  /** 证明目的 */
  purpose: string;
  /** 来源/出处 */
  source?: string;
  /** 取得时间 */
  acquiredAt?: string;
  /** 文件路径 (相对案件目录) */
  filePath?: string;
}

export interface Claim {
  /** 诉讼请求: 判令删除... / 判令赔偿... / 判令公开道歉... */
  content: string;
  /** 金额 (元) — 适用于赔偿类请求 */
  amount?: number;
}

export interface Case {
  /** 案件唯一 ID, 字母数字+短横线 */
  id: string;
  /** 案件标题 (用于列表显示) */
  title: string;
  /** 案由: 网络侵权名誉权 / 传统媒体名誉权 / 其他 */
  cause: '网络侵权名誉权' | '传统媒体名誉权' | '其他名誉权纠纷';
  /** 原告 */
  plaintiff: Party;
  /** 被告 */
  defendant: Party;
  /** 律师 (选填) */
  lawyer?: Party;
  /** 事实摘要 — 侵权发生的时间/地点/方式/内容/后果 */
  facts: string;
  /** 诉讼请求列表 */
  claims: Claim[];
  /** 证据清单 */
  evidence: Evidence[];
  /** 管辖法院 (选填) */
  court?: string;
  /** 案件创建时间 ISO */
  createdAt: string;
  /** 最后修改时间 ISO */
  updatedAt: string;
}

/** 创建案件时只填必要字段, 其余自动补 */
export type CaseInput = Omit<Case, 'createdAt' | 'updatedAt'>;
