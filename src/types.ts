/**
 * 文书类型常量 — 4 个 MVP 文书。
 */
export const DOCUMENT_TYPES = ['letter', 'complaint', 'defense', 'evidence-list'] as const;
export type DocumentType = (typeof DOCUMENT_TYPES)[number];

export const DOCUMENT_TYPE_LABELS: Record<DocumentType, string> = {
  letter: '律师函',
  complaint: '民事起诉状',
  defense: '民事答辩状',
  'evidence-list': '证据目录',
};

/** 文书类型 → 模板文件名 (去掉 .md) */
export const TEMPLATE_NAMES: Record<DocumentType, string> = {
  letter: 'letter',
  complaint: 'complaint',
  defense: 'defense',
  'evidence-list': 'evidence-list',
};
