import { analyzeComplaint } from '../src/analyzer/complaint-parser';
import { writeFileSync } from 'node:fs';

const SAMPLE = `# 民事起诉状

## 原告

- **姓名/名称**：张三
- **身份证号**：110101199001011234
- **住所地**：北京市东城区某某路 1 号

## 被告

- **姓名/名称**：李四
- **住所地**：上海市黄浦区某某路 100 号

## 案由

网络侵权名誉权

## 诉讼请求

1. 依法判令被告立即停止对原告名誉权的侵害 (删除所有侵权微博);
2. 依法判令被告在微博平台公开向原告赔礼道歉、消除影响、恢复名誉;
3. 依法判令被告赔偿原告因维权所支出的合理费用合计人民币 30000 元;
4. 依法判令被告赔偿原告精神损害抚慰金人民币 50000 元;
5. 依法判令被告承担本案全部诉讼费。

## 事实与理由

被告通过微博账号 @李四微博 发布侵权内容为"张三是个骗子"等。

## 法律依据

1. 《中华人民共和国民法典》第一千零二十四条；
2. 《中华人民共和国民法典》第一千零二十五条。

此致

北京市东城区人民法院
`;

async function main() {
  const r = await analyzeComplaint(SAMPLE, { draft: true });
  if (!r.ok) { console.error('FAIL:', r.error); process.exit(1); }
  console.log(JSON.stringify(r.analysis, null, 2));
  writeFileSync('/tmp/analyze-result.json', JSON.stringify(r.analysis, null, 2));
}
main();
