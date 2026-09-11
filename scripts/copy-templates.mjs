// tsc 不复制 .md 资源; src/templates 必须同步进 dist, 否则 bin/dsh.mjs 走 dist 路径时 generate 报 ENOENT
import { cpSync } from 'node:fs';

cpSync('src/templates', 'dist/src/templates', { recursive: true });
