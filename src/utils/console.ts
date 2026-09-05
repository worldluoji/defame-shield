/**
 * CLI 工具函数 — 彩色输出 / 错误退出
 */
import chalk from 'chalk';

export const out = {
  info: (msg: string): void => {
    // eslint-disable-next-line no-console
    console.log(chalk.blue('ℹ'), msg);
  },
  success: (msg: string): void => {
    // eslint-disable-next-line no-console
    console.log(chalk.green('✓'), msg);
  },
  warn: (msg: string): void => {
    // eslint-disable-next-line no-console
    console.warn(chalk.yellow('⚠'), msg);
  },
  error: (msg: string): void => {
    // eslint-disable-next-line no-console
    console.error(chalk.red('✗'), msg);
  },
  dim: (msg: string): void => {
    // eslint-disable-next-line no-console
    console.log(chalk.dim(msg));
  },
};

/** 退出码 1 */
export function die(msg: string): never {
  out.error(msg);
  process.exit(1);
}
