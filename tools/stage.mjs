/**
 * 暂存发布清单里的内容
 *
 *   node tools/stage.mjs          按 .gitignore 的白名单执行 git add
 *   node tools/stage.mjs --dry    只打印清单，不动 git
 *
 * 清单来源只有一个：.gitignore 里以 ! 开头的行。
 * 不读别的配置文件，也不做路径推导。
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const GITIGNORE = path.join(ROOT, '.gitignore');
const dry = process.argv.includes('--dry');

if (!fs.existsSync(path.join(ROOT, '.git'))) {
  console.error('这里还不是 git 仓库。先执行：git init -b main');
  process.exit(1);
}

const allow = fs
  .readFileSync(GITIGNORE, 'utf8')
  .split(/\r?\n/)
  .map((line) => line.trim())
  .filter((line) => line.startsWith('!') && !line.startsWith('!#'))
  .map((line) => line.slice(1).replace(/\/$/, ''));

const missing = allow.filter((p) => !fs.existsSync(path.join(ROOT, p)));

// 文件被删掉是合法操作：跳过它（删除本身由 git add -A 之外的方式记录），但要明确告诉你
if (missing.length) {
  console.log(`注意：清单里有 ${missing.length} 项已不存在（可能被删了），跳过：`);
  for (const p of missing) console.log(`  - ${p}`);
  console.log('');
}

const existing = allow.filter((p) => !missing.includes(p));

// 被白名单挡在外面的顶层条目 —— 只是报告，不做判断
const allowTop = new Set(allow.map((p) => p.split('/')[0]));
const ignoredTop = fs
  .readdirSync(ROOT, { withFileTypes: true })
  .map((d) => d.name)
  .filter((name) => name !== '.git' && !allowTop.has(name))
  .sort();

console.log(`清单（${allow.length} 项）：`);
for (const p of allow) console.log(`  + ${p}`);
console.log(`\n不在清单里（不会提交，共 ${ignoredTop.length} 项）：`);
console.log(`  ${ignoredTop.join('  ')}`);

if (dry) {
  console.log('\n--dry：没有执行 git add');
  process.exit(0);
}

execFileSync('git', ['add', '--', ...existing], { cwd: ROOT, stdio: 'inherit' });
console.log('\n已暂存。下一步：');
console.log('  git status --short      看暂存了什么');
console.log('  git commit -m "..."     提交');
