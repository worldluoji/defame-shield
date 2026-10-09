/**
 * draft 模式 — 纯关键词/正则抽取 (不调 LLM, 粗糙但离线可用)
 *
 * 与 ai-parse.ts 是同一 schema 的两种独立实现; 领域不变量:
 *   抓不准的字段宁可留空 (如侵权时间/地点 — 程序性反点依赖, 误报比缺报代价高)
 */
import { classifyLawCategory, extractArticleNumber } from './law-utils.js';
import type {
  ComplaintAnalysis,
  ParsedClaim,
  ParsedEvidence,
  ParsedFacts,
  ElementScore,
  LegalBasisItem,
} from './complaint-types.js';

/**
 * 关键词抽取 — 不调 LLM, 粗糙但可用
 */
export function extractByKeywords(text: string, source: string): ComplaintAnalysis {
  const warnings: string[] = [];

  // 姓名抽取
  const plaintiffName = extractName(text, '原告');
  const defendantName = extractName(text, '被告');

  // 诉请抽取
  const claims = extractClaims(text);
  if (claims.length === 0) warnings.push('未能识别诉请, 请人工检查');

  // 事实抽取
  const facts = extractFacts(text);
  if (!facts.time) warnings.push('未识别到侵权时间, 诉讼时效反点无法自动评估');

  // 证据抽取
  const evidence = extractEvidence(text);

  // 法条抽取
  const legalBasisRaw = extractLegalBasis(text);
  const legalBasisItems = legalBasisRaw.map((raw) => ({
    raw,
    category: classifyLawCategory(raw) as LegalBasisItem['category'],
    article: extractArticleNumber(raw),
  }));

  // 起诉法院抽取
  const courtOfFiling = extractCourtOfFiling(text);

  // 起诉日期抽取 (诉讼时效计算基准)
  const filingDate = extractFilingDate(text);

  // 元素评分 (粗略)
  const elementScore = estimateElementScore(text);

  // 反驳优先级
  const rebuttalPriority = claims.map((c) => c.index);

  // 置信度启发式: 按抽取完整度累加, draft 封顶 0.7 (规则抽取不可能比 AI 更自信)
  let confidence = 0.2;
  if (plaintiffName) confidence += 0.1;
  if (defendantName) confidence += 0.1;
  if (courtOfFiling) confidence += 0.05;
  if (filingDate) confidence += 0.05;
  if (facts.time) confidence += 0.05;
  confidence += Math.min(0.15, claims.length * 0.05);
  confidence = Math.min(0.7, Math.round(confidence * 100) / 100);

  return {
    source,
    analyzedAt: new Date().toISOString(),
    mode: 'draft',
    parties: {
      原告: { name: plaintiffName, role: '原告' },
      被告: { name: defendantName, role: '被告' },
    },
    cause: '网络侵权名誉权',
    claims,
    facts,
    evidence,
    legalBasis: legalBasisRaw,
    legalBasisItems,
    elementScore,
    rebuttalPriority,
    confidence,
    warnings,
    courtOfFiling,
    filingDate,
  };
}

/**
 * 抽取起诉法院 — "此致" 后面或单独 "向 XX 法院 提起诉讼"
 */
function extractCourtOfFiling(text: string): string | undefined {
  // 1) "此致\n\nXX 法院" / "此致 XX 法院"
  let m = text.match(/此致\s*\n?\s*([^\n]+人民法院)/);
  if (m && m[1]) return m[1].trim();

  // 2) "向 XX 法院 提起诉讼"
  m = text.match(/向\s*([^\n。]+?人民法院)\s*提起/);
  if (m && m[1]) return m[1].trim();

  // 3) 单独的 "XX 人民法院" 出现在正文末尾
  const matches = text.match(/[一-龥]{2,30}人民法院/g);
  if (matches && matches.length > 0) return matches[matches.length - 1]!.trim();

  return undefined;
}

function extractName(text: string, role: string): string {
  // 优先匹配 Markdown "## 原告" 标题块
  const sectionRe = new RegExp(`##\\s*${role}[\\s\\S]{0,300}`, 'm');
  const section = text.match(sectionRe)?.[0] ?? '';
  if (section) {
    // 跳过 markdown 强调 ** **, 然后匹配 "姓名: 张三" / "姓名/名称：张三" / "名称 张三"
    // {2,20}: 公司法人名称普遍 10 字以上, 截到 8 字会得到残缺名称
    const m = section.match(/(?:姓名|名称)[/\\s]*\*?\*?\s*[:：]\s*\*?\*?([^\n*，,\s]{2,20})/)?.[1];
    if (m && m !== '姓名' && m !== '名称') return m.trim();
  }
  // 兜底: "原告张三" "原告：张三" "被告李四"
  // 与/和/及/的 作停止字符, 防止叙述句 ("原告与被告达成…") 被当名称吃进去
  const inlineM = text.match(new RegExp(`${role}[:：]?\\s*([^\\s\\n,，、:：*与和及的]{2,20})`, 'm'))?.[1];
  return inlineM && inlineM !== '姓名' && inlineM !== '名称' ? inlineM.trim() : '';
}

/** 清洗 PDF→markdown 逐字换行: 去空格, 但保留数字/字母之间的断行 (如 "1. 1万余次") */
function joinCjk(s: string): string {
  return s.replace(/([一-龥，。、；：（）""''《》%])[ \t\n]+(?=[一-龥，。、；：（）""''《》])/g, '$1');
}

/** PDF 转换产生的噪声行: 页码/骑缝残字 (应过滤, 不当作诉请续行) */
function isNoiseLine(t: string): boolean {
  return /^\d{1,3}$/.test(t) || /^[一-龥]{1,2}$/.test(t) || /^[-—*_·\s]+$/.test(t);
}

function extractClaims(text: string): ParsedClaim[] {
  // 段标题: 诉讼请求 / 请求事项 (真实起诉状两种都有), 可带可不带 markdown 井号
  const sectionMatch = text.match(
    /(?:^|\n)[# \t*]*(?:诉讼请求|请求事项)[# \t]*[:：]?[ \t]*\n?([\s\S]*?)(?=\n[# \t*]*(?:事实[与和]理由|法律依据|证据清单|此致)|\n综上|$)/,
  );
  if (!sectionMatch || !sectionMatch[1]) return [];
  const items: ParsedClaim[] = [];

  const finish = (index: number, parts: string[]): void => {
    const content = joinCjk(parts.join(' ')).replace(/\s+/g, ' ').trim();
    if (content.length > 5) {
      items.push({
        index,
        content: content.slice(0, 200),
        type: classifyClaim(content),
        amount: extractAmount(content),
      });
    }
  };

  // 逐行扫: "1. xxx" / "(1) xxx" / "1、xxx" 开头为新诉请; 后续非编号行是 PDF 换行的续行
  // 先把同一行内以 ；/。 分隔的 "2. xxx" 拆到独立行 (纯文本标题版式: "请求事项：1. …；2. …")
  const section = sectionMatch[1].replace(
    /([；;。])[ \t]*(?=[（(]?(?:\d{1,2}|[一二三四五六七八九十]+)[）)]?[、.．:：\s])/g,
    '$1\n',
  );
  let cur: { index: number; parts: string[] } | null = null;
  for (const raw of section.split('\n')) {
    const t = raw.trim();
    if (!t) continue;
    const m = t.match(/^[（(]?(\d+)[）)]?[、.．:：\s]\s*(.+)$/) ?? t.match(/^[一二三四五六七八九十]+[、.．]\s*(.+)$/);
    if (m) {
      if (cur) finish(cur.index, cur.parts);
      cur = /^\d/.test(m[1]!)
        ? { index: parseInt(m[1]!, 10), parts: [m[2]!] }
        : { index: items.length + 1, parts: [m[1]!] };
    } else if (cur && !isNoiseLine(t)) {
      cur.parts.push(t);
    }
  }
  if (cur) finish(cur.index, cur.parts);
  return items;
}

function classifyClaim(content: string): ParsedClaim['type'] {
  if (/(停止侵害|删除|屏蔽|断开链接|下架)/.test(content)) return 'stop_infringement';
  // "道歉声明置顶 N 日, 消除...不良影响" 是真实起诉状里恢复名誉的主要形态, 措辞常不连续
  if (/(赔礼道歉|道歉|致歉|恢复名誉)/.test(content) || /消除[^。\n]{0,20}影响/.test(content)) return 'restore_reputation';
  if (/(精神损害|抚慰金)/.test(content)) return 'spiritual_compensation';
  if (/(合理费用|律师费|公证费|差旅费|误工费|赔偿.*?元)/.test(content)) return 'compensate_loss';
  if (/(诉讼费|公告费)/.test(content)) return 'litigation_cost';
  return 'other';
}

function extractAmount(content: string): number | undefined {
  const m = content.match(/(\d[\d,，]*)\s*元/);
  if (!m || !m[1]) return undefined;
  return parseInt(m[1].replace(/[,，]/g, ''), 10);
}

const TORT_PLATFORM_RE = /(新浪微博|微博|抖音|微信|朋友圈|公众号|视频号|哔哩哔哩|B站|b站|快手|小红书|知乎|豆瓣|贴吧|今日头条|头条|短视频|网站|论坛|报纸|杂志|电台|电视台)/;

/**
 * 侵权平台识别 — 优先取"发布/上传/直播"等侵权行为动词前 80 字内的平台词,
 * 避免全文首个命中造成误报 (如被告公司简介里的"互联网电视")
 */
function findTortPlatform(section: string): string | undefined {
  for (const v of section.matchAll(/(?:发布|发表|上传|发帖|撰写|直播|刊登|转载|置顶)/g)) {
    const win = section.slice(Math.max(0, v.index - 80), v.index);
    const pm = win.match(TORT_PLATFORM_RE);
    if (pm && pm[1]) return pm[1];
  }
  const all = section.match(TORT_PLATFORM_RE);
  return all ? all[1] : undefined;
}

const TORT_ACTION_VERB_RE = /(发布|发表|上传|发帖|撰写|直播|刊登|转载|置顶|侮辱|诽谤)/;

/**
 * 侵权时间 — 保守策略: 只认句/行首日期, 且"同一句"内须同时出现 被告/被诉/侵权 与侵权行为动词。
 * 事实段里公司成立日/公告日 ("2021年3月30日, 原告在港交所发布公告") 同样含动词"发布",
 * 但句中无"被告", 据此排除 — 抓到历史日期会让诉讼时效反点误报。
 */
function findTortTime(section: string): string | undefined {
  for (const m of section.matchAll(/(?:^|[。\n])\s*(\d{4}\s*年(?:\s*\d{1,2}\s*月(?:\s*\d{1,2}\s*日)?)?)/g)) {
    const sentence = section.slice(m.index + m[0].length).split('。')[0] ?? '';
    if (/(被告|被诉|侵权)/.test(sentence) && TORT_ACTION_VERB_RE.test(sentence)) {
      return m[1]!.replace(/\s+/g, ' ').trim();
    }
  }
  const on = section.match(/于\s*(\d{4}\s*年(?:\s*\d{1,2}\s*月(?:\s*\d{1,2}\s*日)?)?)\s*(?:发布|发表|撰写|发帖|上传|转发)/);
  return on?.[1]?.replace(/\s+/g, ' ').trim();
}

function extractFacts(text: string): ParsedFacts {
  // 段标题: "事实与理由" / "事实和理由", markdown 井号与冒号可有可无 (PDF 转换多为纯文本)
  const sectionMatch = text.match(
    /(?:^|\n)[# \t*]*事实[与和]理由[# \t]*[:：]?[ \t]*\n?([\s\S]*?)(?=\n[# \t*]*(?:法律依据|证据清单|此致)|\n综上|$)/,
  );
  // joinCjk: PDF 逐字换行会把 "哔哩哔哩" 拆成 "哔哩\n哔哩", 先拼回再抽取平台/时间/内容
  const section = joinCjk(sectionMatch && sectionMatch[1] ? sectionMatch[1].trim() : text);

  const tortMethod = findTortPlatform(section) ??
    section.match(/(?:通过|利用)([^，,。;；\n]{2,30}?)(?:发布|传播|发帖|撰文)/)?.[1]?.trim() ??
    '（未识别）';

  const tortContent =
    section.match(/(?:内容为|内容包含|所述为|表述为|写道|声称)[:：]?[""「」]?([\s\S]{20,500}?)[""」]?(?:[。！？\n]|$)/)?.[1]?.trim() ??
    section.slice(0, 300);

  const spread =
    section.match(/(粉丝\s*[\d,，]+|浏览\s*[\d,，]+|阅读\s*[\d,，]+|转发\s*[\d,，]+|播放\s*[\d,，]+|播放量[^\d\n]{0,8}\d[\d,，]*)/)?.[0] ??
    '';

  // 抓不到就留空 — 宁可缺数据也不误报年份 (诉讼时效反点依赖此字段)
  const time = findTortTime(section);

  // 侵权地点: 只认介词后紧跟的省/市级行政区划 ("在北京市朝阳区发布" → 北京市) — 管辖反点依赖此字段;
  // 不收 区/县: "在小区群里发布" 会误抽 "小区"
  const place = section.match(/(?:在|于)([一-龥]{1,8}?(?:省|市))/)?.[1]?.trim();

  return {
    tortMethod,
    tortContent: tortContent.slice(0, 500),
    spread,
    time,
    place,
  };
}

/**
 * 起诉日期 — 优先 "此致" 之后的落款 (具状人/起诉人 + 年月日),
 * 兜底 "于 X 年 X 月 X 日提起(本)诉" 字样
 */
function extractFilingDate(text: string): string | undefined {
  const fmt = (m: RegExpMatchArray): string => {
    const y = m[1]!;
    const mo = m[2] ? m[2].padStart(2, '0') : undefined;
    const d = m[3] ? m[3].padStart(2, '0') : undefined;
    if (mo && d) return `${y}-${mo}-${d}`;
    if (mo) return `${y}-${mo}`;
    return y;
  };
  const refIdx = text.lastIndexOf('此致');
  const tail = refIdx >= 0 ? text.slice(refIdx) : text.slice(-400);
  let m = tail.match(/(\d{4})\s*年\s*(\d{1,2})\s*月\s*(\d{1,2})\s*日/);
  if (m) return fmt(m);
  m = tail.match(/(\d{4})\s*年\s*(\d{1,2})\s*月/);
  if (m) return fmt(m);
  m = text.match(/于\s*(\d{4})\s*年\s*(\d{1,2})\s*月(?:\s*(\d{1,2})\s*日)?\s*(?:提起|起诉)/);
  if (m) return fmt(m);
  return undefined;
}

function extractEvidence(text: string): ParsedEvidence[] {
  // 只在"证据"段抽取 (起诉状末尾的"证据清单"小节)
  const sectionMatch = text.match(/(?:^|\n)#{0,3}\s*证据(?:清单|目录|列表)?[：:]?\s*\n+([\s\S]*?)$/);
  const section = sectionMatch && sectionMatch[1] ? sectionMatch[1] : '';
  if (!section) return [];
  const items: ParsedEvidence[] = [];
  // 匹配 "证据 1: xxx" "1. xxx" "(1) xxx" "1、xxx"
  const re = /^[ \t]*(?:证据\s*)?[（(]?(\d+)[）)]?[、.．:\s]+([^\n]+)/gm;
  let m: RegExpExecArray | null;
  let idx = 0;
  while ((m = re.exec(section)) !== null && idx < 30) {
    idx++;
    if (!m[1] || !m[2]) continue;
    const fullText = m[2].trim();
    const name = fullText.slice(0, 50);
    if (name.length < 2) continue;

    // 提取来源: "出自 XX" / "来源: XX" / "XX公证处" / "XX公司"
    const sourceMatch = fullText.match(/(?:来源|出自|由|系)[:：]?\s*([^\n,，;；)）]{2,30})/) ||
                        fullText.match(/([一-龥]{2,15}(?:公证处|人民法院|公司|医院|律师事务所))/);
    const source = sourceMatch && sourceMatch[1] ? sourceMatch[1].trim() : undefined;

    // 提取时间: 2025-06-02 / 2025年6月2日
    const dateMatch = fullText.match(/(\d{4})[-年](\d{1,2})[-月](\d{1,2})/);
    const acquiredAt = dateMatch ? `${dateMatch[1]}-${dateMatch[2]!.padStart(2, '0')}-${dateMatch[3]!.padStart(2, '0')}` : undefined;

    // 公证检测
    const notarized = /公证书|公证[处局]|经.*?公证/.test(fullText);
    const notaryInfo = fullText.match(/(.{0,10}公证(?:处|局|员)?[，,]?\s*公证书?[号码字]?[为]?\s*[\d零一二三四五六七八九]+)/)?.[0];

    items.push({
      index: idx,
      name,
      kind: guessKind(name),
      purpose: '',
      source,
      acquiredAt,
      notarized,
      notaryInfo,
    });
  }
  return items;
}

function guessKind(name: string): string {
  if (/(截图|公证书|网页|微博|抖音|聊天记录|电子数据)/.test(name)) return '电子数据';
  if (/(合同|发票|通知|证明|证书|文件)/.test(name)) return '书证';
  if (/(录音|录像|视频|音频)/.test(name)) return '视听资料';
  return '书证';
}

function extractLegalBasis(text: string): string[] {
  const items = new Set<string>();
  // 抽 "《...》第 X 条" / "《...》第X条" / "...第 X 条" / "第一千零二十四条"
  // 1) 完整书名号引用
  const re1 = /《[^》]+》第[\s零一二三四五六七八九十百千\d]+条/g;
  let m: RegExpExecArray | null;
  while ((m = re1.exec(text)) !== null) {
    items.add(m[0].trim());
  }
  // 2) 民法典/民诉法 + 条文 (无书名号)
  const re2 = /(民法典|民诉法|民事诉讼法)第[\s零一二三四五六七八九十百千\d]+条/g;
  while ((m = re2.exec(text)) !== null) {
    items.add(m[0].trim());
  }
  // 3) 最高法规定/解答
  const re3 = /最高人民法院[\s\S]{0,30}?(?:解答|规定|意见)/g;
  while ((m = re3.exec(text)) !== null) {
    items.add(m[0].trim().replace(/\s+/g, '').slice(0, 50));
  }
  return Array.from(items);
}

function estimateElementScore(text: string): ElementScore {
  // 简单的评分: 内容越具体 → 越 likely_true
  const hasQuoted = /[""「」"]/.test(text);
  const hasDamageEvidence = /精神|抑郁|解约|损失/.test(text);

  return {
    factAuthenticity: hasQuoted ? 'disputed' : 'unknown',
    // 未识别侵权方式 ≠ 内容不指向原告; 保持 medium, 让反点选择走保守路径
    directedness: 'medium',
    fault: 'unknown',
    damage: hasDamageEvidence ? 'weak' : 'none_proven',
  };
}
