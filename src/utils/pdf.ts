/**
 * Markdown → PDF 转换器 (纯 Node, 无浏览器依赖)
 *
 * 流程: marked 解析 md → tokens → pdfkit 流式输出
 * 排版: 中国法院文书风格 (宋体, 1.5 倍行距, A4, 居中标题)
 */
import { marked, Tokens } from 'marked';
import PDFDocument from 'pdfkit';
import { createWriteStream, existsSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

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
  let useChineseFont = false;
  try {
    // 优先尝试 macOS 内置的 TTF (Arial Unicode 支持 CJK 字符)
    const ttfPath = process.env['CHINESE_TTF'] || '/Library/Fonts/Arial Unicode.ttf';
    if (existsSync(ttfPath)) {
      doc.registerFont('CN', ttfPath);
      doc.registerFont('CN-Bold', ttfPath);
      useChineseFont = true;
    }
  } catch {
    // 字体注册失败, fallback 到默认 (PDF 14 base fonts, 中文字符会显示为方块)
  }
  const fonts: FontPair = useChineseFont
    ? { regular: 'CN', bold: 'CN-Bold' }
    : { regular: 'Times-Roman', bold: 'Times-Bold' };
  if (!useChineseFont) {
    // 提示用户安装 Chrome 或指定 CHINESE_TTF 环境变量
    console.warn(
      '\n[warn] 未找到可用中文字体 (TTF). PDF 中文将显示为方块.\n' +
        '       解决方法: 设置 CHINESE_TTF 环境变量指向 .ttf 字体文件, 或安装 Chrome 用 web 渲染.\n',
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
      const table = token as Tokens.Table;
      // 简化为文本输出
      const colWidth = (doc.page.width - 144) / Math.max(table.header.length, 1);
      table.header.forEach((cell, i) => {
        doc.font(fonts.bold).fontSize(11).text(cell.text, {
          width: colWidth,
          continued: i < table.header.length - 1,
        });
      });
      doc.font(fonts.regular).fontSize(11);
      for (const row of table.rows) {
        row.forEach((cell, i) => {
          doc.text(cell.text, {
            width: colWidth,
            continued: i < row.length - 1,
          });
        });
        doc.moveDown(0.2);
      }
      doc.moveDown(0.3);
      doc.font(fonts.regular).fontSize(12);
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
      // 跳过不支持的 token (html, def, table, etc.)
      break;
  }
}

function addFooter(doc: PDFKit.PDFDocument, pageNum: number, total: number, options: PdfOptions, fonts: FontPair): void {
  const footerY = doc.page.height - 50;
  doc.font(fonts.regular).fontSize(9).fillColor('#666');

  // 案号 (左侧)
  if (options.caseNumber) {
    doc.text(options.caseNumber, 72, footerY, { lineBreak: false });
  }

  // 页码 (右侧)
  if (options.showPageNumber !== false) {
    doc.text(`第 ${pageNum} 页 / 共 ${total} 页`, 0, footerY, {
      align: 'right',
      width: doc.page.width - 72,
      lineBreak: false,
    });
  }

  doc.fillColor('#000');
}
