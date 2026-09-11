/**
 * dsh fill — 非交互式回填拆解结果 JSON (供 agent / 批量使用)
 *
 * dsh fill <analysis.json> [--set "路径=值"]... [--from patches.json] [--allow-new] [--out <json>]
 *
 * 定位: complaint-analysis.json 是文书的唯一事实源 — 在这里补事实,
 * 重跑 `generate defense` 时对应的 [待补充] 占位符自然消失。
 * 与交互式的 `dsh fill-defense` (直接改文书文本) 互补:
 *   fill        = JSON 层, 非交互, 可审计, 重生成后不丢
 *   fill-defense = 文书层, 人工润色最后一遍
 *
 * 安全约束 (法律数据, 从严):
 *   - 默认只允许写**已存在**的字段 (点路径 + 数组下标), 防止凭空发明字段
 *   - --allow-new 仅放宽**末端**缺失字段 (父级路径必须已存在; draft 拆解常整个省略未知可选键);
 *     中间层路径缺失一律拒绝 (说明路径写错)
 *   - 值类型跟随原字段: number/boolean 字段校验后转换, 不接受垃圾字面量
 *   - 全部成功才写盘 (原子); 任一路径非法则一条都不落
 *   - 每次回填在 JSON 顶层追加 _fillLog 审计记录 (path / previous / value / filledAt)
 */
import { existsSync } from 'node:fs';
import { basename } from 'node:path';
import { readJsonFile, writeJsonFile } from '../utils/json.js';
import { out, die } from '../utils/console.js';
import type { ComplaintAnalysis, FillLogEntry } from '../analyzer/complaint-types.js';

export interface FillAnalysisFlags {
  /** 重复的 --set "路径=值" 项 (按第一个 = 拆分) */
  set?: string[];
  /** 批量回填 JSON: {路径: 值} 或 [{path, value, note?}] */
  from?: string;
  /** 允许新增根级缺失字段 */
  allowNew?: boolean;
  /** 输出路径 (默认: 原地写回) */
  out?: string;
}

type JsonValue = string | number | boolean | null;

interface Patch {
  path: string;
  value: JsonValue;
  note?: string;
}

interface Resolved {
  ok: boolean;
  error?: string;
  parent?: Record<string, unknown> | unknown[];
  key?: string | number;
  old?: unknown;
  /** 末端字段缺失 (父级存在) 时为 true — --allow-new 放行的唯一情形 */
  missing?: boolean;
}

function resolvePath(root: Record<string, unknown>, path: string): Resolved {
  const segs = path.split('.').map((s) => s.trim()).filter((s) => s.length > 0);
  if (segs.length === 0) return { ok: false, error: '路径为空' };

  let cursor: unknown = root;
  let parent: Record<string, unknown> | unknown[] | undefined;
  let key: string | number | undefined;

  for (let i = 0; i < segs.length; i++) {
    const seg = segs[i]!;
    if (cursor === null || typeof cursor !== 'object') {
      return { ok: false, error: `路径 "${path}" 在 "${seg}" 之前已不是对象/数组` };
    }
    if (Array.isArray(cursor)) {
      const idx = Number(seg);
      if (!Number.isInteger(idx) || idx < 0 || idx >= cursor.length) {
        return { ok: false, error: `路径 "${path}" 的数组下标 [${seg}] 越界或非整数` };
      }
      parent = cursor;
      key = idx;
      cursor = cursor[idx];
    } else {
      const obj = cursor as Record<string, unknown>;
      if (!(seg in obj)) {
        // 末端字段缺失: 父级存在, --allow-new 可放行 (draft 拆解常整个省略未知可选键)
        if (i === segs.length - 1) {
          return { ok: false, error: `字段 "${path}" 不存在 (父级存在)`, missing: true, parent: obj, key: seg };
        }
        // 中间层缺失: 路径写错, 一律拒绝
        return { ok: false, error: `路径 "${path}" 的父级 "${segs.slice(0, i + 1).join('.')}" 不存在` };
      }
      parent = obj;
      key = seg;
      cursor = obj[seg];
    }
  }
  return { ok: true, parent, key, old: cursor };
}

/** 按原字段类型适配写入值; 返回 undefined 表示不合法 */
function coerceValue(old: unknown, value: JsonValue): string | number | boolean | undefined {
  if (value === null) {
    return old === null || old === '' || old === undefined ? '' : undefined;
  }
  if (typeof value === 'number') {
    if (old === undefined) return value;
    return typeof old === 'number' || typeof old === 'string' ? String(value) : undefined;
  }
  if (typeof value === 'boolean') {
    return old === undefined || typeof old === 'boolean' ? value : undefined;
  }
  switch (typeof old) {
    case 'number': {
      const n = Number(value);
      return value.trim() !== '' && Number.isFinite(n) ? n : undefined;
    }
    case 'boolean':
      if (value === 'true') return true;
      if (value === 'false') return false;
      return undefined;
    case 'string':
    case 'undefined':
      return value;
    default:
      // object / array / null 字段拒绝标量覆盖结构
      return undefined;
  }
}

function parseSetPairs(pairs: string[]): Patch[] {
  const result: Patch[] = [];
  for (const pair of pairs) {
    const eq = pair.indexOf('=');
    if (eq <= 0) die(`--set 需为 "路径=值" 形式 (缺 = 或路径为空): ${pair}`);
    result.push({ path: pair.slice(0, eq).trim(), value: pair.slice(eq + 1) });
  }
  return result;
}

function parseFrom(fromPath: string): Patch[] {
  const data = readJsonFile<unknown>(fromPath);
  const patches: Patch[] = [];
  const push = (path: unknown, value: unknown, note?: unknown): void => {
    if (typeof path !== 'string') die(`--from 中 path 必须为字符串: ${JSON.stringify(path)}`);
    if (value !== null && typeof value !== 'string' && typeof value !== 'number' && typeof value !== 'boolean') {
      die(`--from 中 "${path}" 的值必须是字符串/数字/布尔/null (不支持对象/数组): ${JSON.stringify(value)}`);
    }
    patches.push({ path, value: value as JsonValue, note: typeof note === 'string' ? note : undefined });
  };
  if (Array.isArray(data)) {
    for (const item of data) {
      if (item === null || typeof item !== 'object' || typeof (item as { path?: unknown }).path !== 'string') {
        die('--from 数组形式每项需为 {path, value, note?}');
      }
      push((item as { path: string }).path, (item as { value?: unknown }).value, (item as { note?: unknown }).note);
    }
  } else if (data !== null && typeof data === 'object') {
    for (const [k, v] of Object.entries(data as Record<string, unknown>)) push(k, v);
  } else {
    die('--from 内容需为对象 {路径: 值} 或数组 [{path, value, note?}]');
  }
  if (patches.length === 0) die(`--from 文件为空: ${fromPath}`);
  return patches;
}

/**
 * 纯函数核心: 把 patches 应用到 analysis (会修改传入对象)。
 * 任一路径/值非法 → 抛 Error (调用方决定错误呈现), 不产生部分写入。
 */
export function applyFillPatches(
  analysis: ComplaintAnalysis,
  patches: Patch[],
  opts: { allowNew?: boolean } = {},
): Array<{ path: string; old: unknown; value: string | number | boolean }> {
  const root = analysis as unknown as Record<string, unknown>;
  const errors: string[] = [];
  // 两遍式: 先全部校验, 任一失败抛错, 全部合法才落改 (函数级原子)
  const planned: Array<{ set: () => void; path: string; old: unknown; value: string | number | boolean }> = [];

  for (const p of patches) {
    const r = resolvePath(root, p.path);
    if (!r.ok) {
      if (r.missing && opts.allowNew && r.parent) {
        const coerced = coerceValue(undefined, p.value);
        if (coerced === undefined) {
          errors.push(`${p.path}: 值 ${JSON.stringify(p.value)} 类型不合法`);
          continue;
        }
        const parent = r.parent as Record<string, unknown>;
        const key = r.key as string;
        planned.push({ set: () => { parent[key] = coerced; }, path: p.path, old: undefined, value: coerced });
        continue;
      }
      if (r.missing) {
        errors.push(`${p.path}: 字段不存在 (若确需新增, 加 --allow-new)`);
        continue;
      }
      errors.push(`${p.path}: ${r.error ?? '路径无法解析'}`);
      continue;
    }
    const coerced = coerceValue(r.old, p.value);
    if (coerced === undefined) {
      errors.push(`${p.path}: 值 ${JSON.stringify(p.value)} 与原字段类型 (${r.old === null ? 'null' : typeof r.old}) 不匹配`);
      continue;
    }
    const parent = r.parent as Record<string, unknown>;
    const key = r.key as string;
    planned.push({ set: () => { parent[key] = coerced; }, path: p.path, old: r.old, value: coerced });
  }

  if (errors.length > 0) throw new Error(errors.join('\n'));

  const applied: Array<{ path: string; old: unknown; value: string | number | boolean }> = [];
  for (const pl of planned) {
    pl.set();
    applied.push({ path: pl.path, old: pl.old, value: pl.value });
  }
  return applied;
}

export async function fillAnalysisCommand(analysisPath: string, flags: FillAnalysisFlags): Promise<void> {
  if (!existsSync(analysisPath)) die(`拆解结果文件不存在: ${analysisPath}`);
  const pairs = flags.set ?? [];
  if (pairs.length === 0 && !flags.from) {
    die('未指定任何回填项 — 用 --set "路径=值" (可重复) 或 --from patches.json');
  }

  const patches: Patch[] = [
    ...parseSetPairs(pairs),
    ...(flags.from ? parseFrom(flags.from) : []),
  ];

  const analysis = readJsonFile<ComplaintAnalysis>(analysisPath);
  let applied: Array<{ path: string; old: unknown; value: string | number | boolean }>;
  try {
    applied = applyFillPatches(analysis, patches, { allowNew: flags.allowNew });
  } catch (e) {
    die(`回填失败 (未写入任何内容):\n${(e as Error).message}`);
  }

  const stamp = new Date().toISOString();
  const log: FillLogEntry[] = analysis._fillLog ?? [];
  applied.forEach((a, i) => {
    const note = patches[i]?.note;
    log.push({
      path: a.path,
      previous: (a.old ?? null) as string | number | boolean | null,
      value: a.value,
      filledAt: note ? `${stamp} # ${note}` : stamp,
    });
  });
  analysis._fillLog = log;

  const outPath = flags.out ?? analysisPath;
  writeJsonFile(outPath, analysis);
  for (const a of applied) {
    out.success(`${a.path}: ${JSON.stringify(a.old ?? '')} → ${JSON.stringify(a.value)}`);
  }
  out.info(`共回填 ${applied.length} 项 (_fillLog 审计记录累计 ${log.length} 条)`);
  out.dim(outPath === analysisPath ? `已原地写回: ${outPath}` : `已另存: ${outPath}`);
  out.info(`下一步: dsh generate defense --case <id> --from-analysis ${basename(outPath)} — 重生成后对应 [待补充] 自然消失`);
}
