import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const target = path.resolve('index.html');
if (!fs.existsSync(target)) {
  console.error('✗ 未找到 index.html');
  process.exit(1);
}

const html = fs.readFileSync(target, 'utf8');
const checks = [
  ['文档声明', /^<!DOCTYPE html>/i.test(html.trim())],
  ['单一 style 标签', (html.match(/<style>/g) || []).length === 1 && (html.match(/<\/style>/g) || []).length === 1],
  ['单一 script 标签', (html.match(/<script>/g) || []).length === 1 && (html.match(/<\/script>/g) || []).length === 1],
  ['离线导入能力', html.includes('m1ParseXlsxBuffer') && html.includes('m1BuildSnapshot')],
  ['M1 对账能力', html.includes('P0-01') && html.includes('P1-01')],
];

const script = html.match(/<script>([\s\S]*?)<\/script>/);
if (!script) {
  checks.push(['提取内嵌 JavaScript', false]);
} else {
  // The confirmed V6.6.1 prototype is a classic browser script, rather than an ES module.
  // Use a .js temporary file so Node validates with the same duplicate-function semantics.
  const temp = path.join(os.tmpdir(), `people-efficiency-${Date.now()}.js`);
  fs.writeFileSync(temp, script[1], 'utf8');
  const result = spawnSync(process.execPath, ['--check', temp], { encoding: 'utf8' });
  fs.unlinkSync(temp);
  if (result.status !== 0) {
    console.error(result.stderr || result.stdout);
    checks.push(['内嵌 JavaScript（经典脚本）语法', false]);
  } else {
    checks.push(['内嵌 JavaScript（经典脚本）语法', true]);
  }
}

let failed = false;
for (const [label, ok] of checks) {
  console.log(`${ok ? '✓' : '✗'} ${label}`);
  if (!ok) failed = true;
}

if (failed) {
  console.error('\n原型校验失败。请修复后再提交。');
  process.exit(1);
}
console.log('\n原型校验通过。');
