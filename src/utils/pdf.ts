/**
 * Markdown → PDF 转换器 (纯 Node, 无浏览器依赖)
 *
 * 流程: marked 解析 md → tokens → pdfkit 流式输出
 * 排版: 中国法院文书风格 (宋体, 1.5 倍行距, A4, 居中标题)
 */
import { marked, Tokens } from 'marked';
import PDFDocument from 'pdfkit';
import { createWriteStream, existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';

/** PDF 渲染字体对 (中文字体缺失时回退 PDF 内置字体) */
interface FontPair {
  regular: string;
  bold: string;
}

export interface PdfOptions {
  output: string;
  title?: string;
  caseNumber?: string;
  /** 是否显示页码 (默认 true) */
  showPageNumber?: boolean;
}

/** 跨平台候选中文 TTF (纯 TTF; TTC 因 fontkit 2.x 兼容问题不列). Windows 走 SystemRoot/Fonts 动态拼接 */
export function findCjkTtf(): string | null {
  const envFont = process.env['CHINESE_TTF'];
  if (envFont && existsSync(envFont)) return envFont;
  const winFontDir =
    process.platform === 'win32'
      ? join(process.env['SystemRoot'] ?? 'C:\\Windows', 'Fonts')
      : null;
  const candidates = [
    // macOS
    '/Library/Fonts/Arial Unicode.ttf',
    // Windows (宋体/雅黑是 TTC, 候选这三个 TTF)
    ...(winFontDir ? [join(winFontDir, 'simhei.ttf'), join(winFontDir, 'simfang.ttf'), join(winFontDir, 'simkai.ttf')] : []),
    // Linux (发行版常见的 CJK TTF fallback)
    '/usr/share/fonts/truetype/droid/DroidSansFallbackFull.ttf',
    '/usr/share/fonts/truetype/droid/DroidSansFallback.ttf',
    '/usr/share/fonts/google-droid/DroidSansFallback.ttf',
  ];
  return candidates.find((p) => existsSync(p)) ?? null;
}

/** 注册中文 TTF; 失败回退 PDF 内置字体 (中文显示为方块) */
function registerCjkFont(doc: PDFKit.PDFDocument): { fonts: FontPair; fontSource: string | null } {
  const fallback = { fonts: { regular: 'Times-Roman', bold: 'Times-Bold' } as FontPair, fontSource: null };
  const ttf = findCjkTtf();
  if (!ttf) return fallback;
  try {
    doc.registerFont('CN', ttf);
    doc.registerFont('CN-Bold', ttf);
    return { fonts: { regular: 'CN', bold: 'CN-Bold' }, fontSource: ttf };
  } catch {
    return fallback;
  }
}

/** 解析 + 生成 */
export async function convertToPdf(mdPath: string, options: PdfOptions): Promise<void> {
  if (!existsSync(mdPath)) {
    throw new Error(`Markdown 文件不存在: ${mdPath}`);
  }

  const { readFileSync } = await import('node:fs');
  const md = readFileSync(mdPath, 'utf-8');

  const outDir = dirname(options.output);
  if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true });

  // 解析 markdown
  const tokens = marked.lexer(md);

  // 创建 PDF
  const doc = new PDFDocument({
    size: 'A4',
    margins: { top: 90, bottom: 90, left: 72, right: 72 },
    info: {
      Title: options.title ?? mdPath.split('/').pop()?.replace(/\.md$/, ''),
      Producer: 'defame-shield CLI',
    },
    bufferPages: true,
  });

  const stream = createWriteStream(options.output);
  doc.pipe(stream);

  // 注册中文字体 (TTF 用 fontkit; TTC 因 fontkit 2.x 兼容问题暂不可用)
  const { fonts, fontSource } = registerCjkFont(doc);
  if (!fontSource) {
    console.warn(
      '\n[warn] 未找到可用中文字体 (TTF). PDF 中文将显示为方块.\n' +
        '       解决方法: 设 CHINESE_TTF 环境变量指向系统任一中文 .ttf 字体文件' +
        ' (macOS: Arial Unicode / Windows: simhei|simfang|simkai / Linux: DroidSansFallback).\n',
    );
  }

  // 设置默认字体
  doc.font(fonts.regular).fontSize(12);

  // 渲染 tokens
  for (const token of tokens) {
    renderToken(doc, token, fonts);
  }

  // 添加页脚 (页码 + 案号)
  const range = doc.bufferedPageRange();
  for (let i = 0; i < range.count; i++) {
    doc.switchToPage(range.start + i);
    addFooter(doc, i + 1, range.count, options, fonts);
  }

  doc.end();

  // 等待流结束
  await new Promise<void>((resolve, reject) => {
    stream.on('finish', () => resolve());
    stream.on('error', reject);
  });
}

function renderToken(doc: PDFKit.PDFDocument, token: Tokens.Generic, fonts: FontPair): void {
  switch (token.type) {
    case 'heading': {
      const h = token as Tokens.Heading;
      const sizes: Record<number, number> = { 1: 18, 2: 14, 3: 13, 4: 12, 5: 12, 6: 12 };
      const size = sizes[h.depth] ?? 12;
      doc.moveDown(0.5);
      if (h.depth === 1) {
        // 主标题居中加粗
        doc.font(fonts.bold).fontSize(size).text(h.text, { align: 'center' });
      } else {
        doc.font(fonts.bold).fontSize(size).text(h.text, { align: 'left' });
      }
      doc.moveDown(0.3);
      doc.font(fonts.regular).fontSize(12);
      break;
    }

    case 'paragraph': {
      const p = token as Tokens.Paragraph;
      doc.text(p.text, { align: 'justify', indent: 24, lineGap: 4 });
      doc.moveDown(0.3);
      break;
    }

    case 'blockquote': {
      const bq = token as Tokens.Blockquote;
      doc.moveDown(0.3);
      doc.fillColor('#555').text(bq.text, { indent: 36, align: 'left' });
      doc.fillColor('#000');
      doc.moveDown(0.3);
      break;
    }

    case 'list': {
      const list = token as Tokens.List;
      doc.font(fonts.regular).fontSize(12);
      list.items.forEach((item, i) => {
        const marker = list.ordered ? `${i + 1}.` : '•';
        const text = item.text.replace(/\n/g, ' ');
        doc.text(`${marker} ${text}`, { indent: 48, align: 'left' });
      });
      doc.moveDown(0.3);
      break;
    }

    case 'table': {
      renderTable(doc, token as Tokens.Table, fonts);
      break;
    }

    case 'hr': {
      doc.moveTo(doc.x, doc.y).lineTo(doc.page.width - 72, doc.y).stroke('#999');
      doc.moveDown(0.5);
      break;
    }

    case 'code': {
      const c = token as Tokens.Code;
      doc.font('Courier').fontSize(10);
      doc.text(c.text, { indent: 24, align: 'left' });
      doc.font(fonts.regular).fontSize(12);
      doc.moveDown(0.3);
      break;
    }

    case 'space':
      doc.moveDown(0.5);
      break;

    default:
      // 跳过不支持的 token (html, def, etc.)
      break;
  }
}

/** 表格网格渲染: 等宽列 + 行底边线; 行整体放不下时整行换页 */
function renderTable(doc: PDFKit.PDFDocument, table: Tokens.Table, fonts: FontPair): void {
  const left = doc.page.margins.left;
  const usable = doc.page.width - left - doc.page.margins.right;
  const cols = Math.max(table.header.length, 1);
  const colWidth = usable / cols;
  const pad = 4;

  const rows: Array<{ cells: string[]; bold: boolean }> = [
    { cells: table.header.map((c) => c.text), bold: true },
    ...table.rows.map((r) => ({ cells: r.map((c) => c.text), bold: false })),
  ];

  doc.fontSize(11);
  doc.lineWidth(0.5).strokeColor('#999');
  let y = doc.y;
  doc.moveTo(left, y).lineTo(left + usable, y).stroke(); // 表头顶线

  for (const row of rows) {
    doc.font(row.bold ? fonts.bold : fonts.regular);
    const heights = row.cells.map((t) => doc.heightOfString(t, { width: colWidth - pad * 2 }));
    const rowHeight = Math.max(11, ...heights) + pad * 2;
    if (y + rowHeight > doc.page.height - doc.page.margins.bottom) {
      doc.addPage();
      y = doc.page.margins.top;
      doc.moveTo(left, y).lineTo(left + usable, y).stroke(); // 新页补一条顶线
    }
    row.cells.forEach((t, i) => {
      doc.text(t, left + i * colWidth + pad, y + pad, { width: colWidth - pad * 2 });
    });
    doc.moveTo(left, y + rowHeight).lineTo(left + usable, y + rowHeight).stroke();
    y += rowHeight;
  }

  doc.strokeColor('#000');
  doc.x = left;
  doc.y = y;
  doc.font(fonts.regular).fontSize(12);
  doc.moveDown(0.3);
}

function addFooter(doc: PDFKit.PDFDocument, pageNum: number, total: number, options: PdfOptions, fonts: FontPair): void {
  const footerY = doc.page.height - 50;
  doc.font(fonts.regular).fontSize(9).fillColor('#666');

  // 案号 (左侧)
  if (options.caseNumber) {
    doc.text(options.caseNumber, 72, footerY, { lineBreak: false });
  }

  // 页码 (右侧) — 手动算 x 右对齐; pdfkit 的 width+align 在此坐标下会误判溢出并新建空白页
  if (options.showPageNumber !== false) {
    const label = `第 ${pageNum} 页 / 共 ${total} 页`;
    const x = doc.page.width - 72 - doc.widthOfString(label);
    doc.text(label, x, footerY, { lineBreak: false });
  }

  doc.fillColor('#000');
}
