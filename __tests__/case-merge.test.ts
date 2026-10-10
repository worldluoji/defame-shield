/**
 * mergeAnalysisIntoCase + normalizeEvidenceArray — 案件层纯函数单元测试
 */
import { describe, it, expect } from 'vitest';
import { applyIdentityProtection, mergeAnalysisIntoCase, normalizeEvidenceArray } from '../src/case/case';
import type { Case } from '../src/case/types';
import type { ComplaintAnalysis } from '../src/analyzer/complaint-types';

function mkCase(overrides: Partial<Case> = {}): Case {
  return {
    id: 'c1',
    title: '测试案件',
    cause: '网络侵权名誉权',
    plaintiff: { name: '[待补充: 由起诉状拆解回填]', role: '原告' },
    defendant: { name: '赵某', role: '被告' },
    facts: '',
    claims: [],
    evidence: [],
    createdAt: '',
    updatedAt: '',
    ...overrides,
  };
}

function mkAnalysis(overrides: Partial<ComplaintAnalysis> = {}): ComplaintAnalysis {
  return {
    source: 'test',
    analyzedAt: '2026-01-01',
    mode: 'draft',
    parties: {
      原告: { name: '王女士', role: '原告', address: '北京市海淀区某路 1 号', contact: '138' },
      被告: { name: '赵某', role: '被告', address: '上海市黄浦区某路 2 号' },
    },
    cause: '网络侵权名誉权',
    claims: [
      { index: 1, content: '停止侵害', type: 'stop_infringement' },
      { index: 2, content: '赔偿 50000 元', type: 'spiritual_compensation', amount: 50000 },
    ],
    facts: { tortMethod: '微博', tortContent: '骗子', spread: '粉丝 80', time: '2025 年 3 月' },
    evidence: [],
    legalBasis: [],
    legalBasisItems: [],
    elementScore: { factAuthenticity: 'unknown', directedness: 'medium', fault: 'unknown', damage: 'weak' },
    rebuttalPriority: [1, 2],
    confidence: 0.3,
    warnings: [],
    ...overrides,
  };
}

describe('mergeAnalysisIntoCase', () => {
  it('原告信息从拆解结果回填 (覆盖占位符)', () => {
    const m = mergeAnalysisIntoCase(mkCase(), mkAnalysis());
    expect(m.plaintiff.name).toBe('王女士');
    expect(m.plaintiff.address).toBe('北京市海淀区某路 1 号');
    expect(m.plaintiff.contact).toBe('138');
  });

  it('诉请被起诉状权威覆盖', () => {
    const m = mergeAnalysisIntoCase(mkCase(), mkAnalysis());
    expect(m.claims).toHaveLength(2);
    expect(m.claims[1]!.amount).toBe(50000);
  });

  it('拆解无诉请时保留原 claims', () => {
    const base = mkCase({ claims: [{ content: '手工填写' }] });
    const m = mergeAnalysisIntoCase(base, mkAnalysis({ claims: [] }));
    expect(m.claims).toEqual([{ content: '手工填写' }]);
  });

  it('被告以人工填写为准, 仅补齐空缺字段', () => {
    const m = mergeAnalysisIntoCase(mkCase(), mkAnalysis());
    expect(m.defendant.name).toBe('赵某');
    expect(m.defendant.address).toBe('上海市黄浦区某路 2 号'); // 原本为空 → 补齐
  });

  it('法院: 空则取起诉法院, 已填则保留', () => {
    const filled = mergeAnalysisIntoCase(mkCase(), mkAnalysis({ courtOfFiling: '北京市海淀区人民法院' }));
    expect(filled.court).toBe('北京市海淀区人民法院');
    const manual = mergeAnalysisIntoCase(mkCase({ court: '上海法院' }), mkAnalysis({ courtOfFiling: '北京法院' }));
    expect(manual.court).toBe('上海法院');
  });

  it('facts: 空时由侵权时间/方式/内容拼摘要, 已填则不动', () => {
    const m = mergeAnalysisIntoCase(mkCase(), mkAnalysis());
    expect(m.facts).toContain('2025 年 3 月');
    expect(m.facts).toContain('微博');
    const manual = mergeAnalysisIntoCase(mkCase({ facts: '人工摘要' }), mkAnalysis());
    expect(manual.facts).toBe('人工摘要');
  });

  it('律师缺失时用拆解结果中的代理律师', () => {
    const m = mergeAnalysisIntoCase(mkCase(), mkAnalysis({
      parties: {
        原告: { name: '王女士', role: '原告' },
        被告: { name: '赵某', role: '被告' },
        律师: { name: '某律师', role: '律师' },
      },
    }));
    expect(m.lawyer?.name).toBe('某律师');
  });

  it('mergeAnalysisIntoCase 从不触碰 defendantFacts / evidence', () => {
    const base = mkCase({ defendantFacts: '被告自己的版本', evidence: [{ index: 1, name: '截图', kind: '书证', purpose: '证明真实消费' }] });
    const m = mergeAnalysisIntoCase(base, mkAnalysis());
    expect(m.defendantFacts).toBe('被告自己的版本');
    expect(m.evidence).toHaveLength(1);
  });
});

describe('mergeAnalysisIntoCase (--keep-identity)', () => {
  it('身份字段不覆盖不回填; 案由/诉请/事实照常回填', () => {
    const base = mkCase({
      plaintiff: { name: '化名甲', role: '原告' },
      defendant: { name: '化名乙', role: '被告' },
    });
    const m = mergeAnalysisIntoCase(base, mkAnalysis(), { keepIdentity: true });
    expect(m.plaintiff.name).toBe('化名甲');
    expect(m.plaintiff.contact).toBeUndefined();
    expect(m.defendant.name).toBe('化名乙');
    expect(m.defendant.address).toBeUndefined();
    expect(m.claims).toHaveLength(2);
    expect(m.facts).toContain('微博');
  });

  it('律师身份也不从拆解回填', () => {
    const a = mkAnalysis({
      parties: {
        原告: { name: '王女士', role: '原告' },
        被告: { name: '赵某', role: '被告' },
        律师: { name: '某律师', role: '律师', contact: '139' },
      },
    });
    expect(mergeAnalysisIntoCase(mkCase(), a, { keepIdentity: true }).lawyer).toBeUndefined();
  });
});

describe('applyIdentityProtection', () => {
  it('用户值优先; case 缺失的证件号/电话打码; 住所保留 (管辖反点要用)', () => {
    const c = mkCase({
      plaintiff: { name: '化名甲', role: '原告' },
      defendant: { name: '化名乙', role: '被告', idNumber: '用户自填证件' },
    });
    const a = mkAnalysis({
      parties: {
        原告: { name: '王女士', role: '原告', address: '北京市海淀区', contact: '13800001111' },
        被告: { name: '赵某', role: '被告', idNumber: '110101199001011234', address: '上海市黄浦区' },
      },
    });
    const r = applyIdentityProtection(a, c);
    expect(r.parties.原告.name).toBe('化名甲');
    expect(r.parties.原告.contact).toBe('[已脱敏]');
    expect(r.parties.原告.address).toBe('北京市海淀区'); // case 未填 → 保留原值
    expect(r.parties.被告.name).toBe('化名乙');
    expect(r.parties.被告.idNumber).toBe('用户自填证件');
    expect(r.parties.被告.address).toBe('上海市黄浦区');
    expect(r.warnings.some((w) => w.includes('已脱敏'))).toBe(true);
    // 纯函数: 原对象不动
    expect(a.parties.被告.idNumber).toBe('110101199001011234');
  });

  it('占位姓名视为未提供 → 保留起诉状姓名 (不硬删)', () => {
    const r = applyIdentityProtection(mkAnalysis(), mkCase());
    expect(r.parties.原告.name).toBe('王女士');
    expect(r.parties.原告.contact).toBe('[已脱敏]'); // mkAnalysis 默认原告有电话
    expect(r.warnings.some((w) => w.includes('已脱敏'))).toBe(true);
  });

  it('律师的证件号/电话同样脱敏', () => {
    const a = mkAnalysis({
      parties: {
        原告: { name: '王女士', role: '原告' },
        被告: { name: '赵某', role: '被告' },
        律师: { name: '某律师', role: '律师', contact: '13900001111', idNumber: '110101198001011234' },
      },
    });
    const r = applyIdentityProtection(a, mkCase());
    expect(r.parties.律师?.contact).toBe('[已脱敏]');
    expect(r.parties.律师?.idNumber).toBe('[已脱敏]');
  });
});

describe('normalizeEvidenceArray', () => {
  it('数组形式: 归一化并自动编号', () => {
    const r = normalizeEvidenceArray([
      { name: '订单截图', kind: '电子数据', purpose: '证明真实消费', source: '平台后台' },
      { name: '证人证言' , purpose: '证明无恩怨' },
    ]);
    expect(r).toHaveLength(2);
    expect(r[0]).toEqual({ index: 1, name: '订单截图', kind: '电子数据', purpose: '证明真实消费', source: '平台后台', acquiredAt: undefined, filePath: undefined });
    expect(r[1]!.kind).toBe('书证');
    expect(r[1]!.index).toBe(2);
  });

  it('{evidence: [...]} 对象形式同样接受', () => {
    const r = normalizeEvidenceArray({ evidence: [{ name: 'a', purpose: 'p' }] });
    expect(r).toHaveLength(1);
  });

  it('非法输入抛错, 绝不静默丢条目', () => {
    expect(() => normalizeEvidenceArray('not json')).toThrow(/数组/);
    expect(() => normalizeEvidenceArray([])).toThrow(/为空/);
    expect(() => normalizeEvidenceArray([{ purpose: '没有 name' }])).toThrow(/缺少 name/);
    expect(() => normalizeEvidenceArray([{ name: 'x' }])).toThrow(/缺少 purpose/);
    expect(() => normalizeEvidenceArray([{ name: 'x', purpose: 'p', kind: '法宝' }])).toThrow(/种类/);
  });
});
