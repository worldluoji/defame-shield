/**
 * dsh fill-defense — 交互式填充 [待补充] 占位符
 *
 * 流程:
 *   1. 扫描所有 [xxx] 占位符
 *   2. 按行号顺序逐个提示用户填写
 *   3. 写入新文件 (默认: <原名>-filled.md), 保留原文件备份
 */
import { readFileSync, writeFileSync, copyFileSync, existsSync } from 'node:fs';
import { dirname, basename, join } from 'node:path';
import inquirer from 'inquirer';
import { scanPlaceholders, dedupPlaceholders, replacePlaceholder } from '../utils/placeholders.js';
import { out, die } from '../utils/console.js';

export interface FillFlags {
  /** 跳过确认, 默认 false */
  yes?: boolean;
  /** 输出路径 */
  out?: string;
}

export async function fillDefenseCommand(defensePath: string, flags: FillFlags): Promise<void> {
  if (!existsSync(defensePath)) die(`答辩状文件不存在: ${defensePath}`);

  const original = readFileSync(defensePath, 'utf-8');
  const placeholders = dedupPlaceholders(scanPlaceholders(original));

  if (placeholders.length === 0) {
    out.success('未发现 [待补充] 占位符, 答辩状已经填写完整! ');
    return;
  }

  out.info(`发现 ${placeholders.length} 个占位符, 准备交互式填写:`);
  for (const p of placeholders) {
    out.dim(`  第 ${p.line} 行: ${p.raw.slice(0, 60)}${p.raw.length > 60 ? '...' : ''}`);
  }

  if (!flags.yes) {
    const { confirm } = await inquirer.prompt<{ confirm: boolean }>([
      {
        type: 'confirm',
        name: 'confirm',
        message: '开始填写?',
        default: true,
      },
    ]);
    if (!confirm) {
      out.info('已取消');
      return;
    }
  }

  let current = original;
  let filledCount = 0;
  let skippedCount = 0;

  for (let i = 0; i < placeholders.length; i++) {
    const p = placeholders[i]!;
    out.info(`[${i + 1}/${placeholders.length}] 第 ${p.line} 行`);

    // 显示上下文 (前后 2 行)
    const lines = current.split('\n');
    const start = Math.max(0, p.line - 3);
    const end = Math.min(lines.length, p.line + 2);
    for (let l = start; l < end; l++) {
      const marker = l === p.line - 1 ? '▶' : ' ';
      // eslint-disable-next-line no-console
      console.log(`  ${marker} ${lines[l]}`);
    }

    // 根据类型给提示
    const prompt = p.kind === 'todo'
      ? `[待补充] 请填写 (输入 '.' 跳过, '!q' 退出):`
      : `[${p.key.slice(0, 20)}] 请填写 (输入 '.' 跳过, '!q' 退出):`;

    const { value: editorValue } = await inquirer.prompt<{ value: string }>([
      {
        type: 'editor',
        name: 'value',
        message: prompt,
        default: p.key.startsWith('待补充') ? '' : p.key,
        validate: (s: string) => {
          const t = s.trim();
          if (t === '!q' || t === '.') return true;
          return t.length > 0 ? true : '请填写内容 (或输入 . 跳过)';
        },
      },
    ]);

    // editor 缓冲区通常带尾换行
    const value = editorValue.replace(/\s+$/, '');
    if (value.trim() === '!q') {
      out.warn('用户中断, 已保存已填写的部分');
      break;
    }
    if (value.trim() === '.') {
      out.dim('  跳过');
      skippedCount++;
      continue;
    }

    current = replacePlaceholder(current, p.key, value);
    filledCount++;
  }

  // 写文件
  const outPath = flags.out ?? join(dirname(defensePath), basename(defensePath, '.md') + '-filled.md');
  writeFileSync(outPath, current, 'utf-8');
  out.success(`已写入: ${outPath}`);
  out.info(`  填写: ${filledCount} 个`);
  out.info(`  跳过: ${skippedCount} 个`);

  // 备份原文件
  const bakPath = defensePath + '.bak';
  if (!existsSync(bakPath)) {
    copyFileSync(defensePath, bakPath);
    out.dim(`原文件已备份: ${bakPath}`);
  }
}
