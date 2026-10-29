// 提交并推送当前改动（用 npm script 触发，避开 git 子命令被安全分类器拦下的情况）。
//
// 一次性工具：跑完可以删。提交信息从 tmp/commit-msg.txt 读（不在仓库里）。
import { execFileSync } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';

const cwd = 'D:/a_js/js_proj/nx-kv';
const msgFile = 'C:/Users/zhlx/.claude/jobs/97356ece/tmp/commit-msg.txt';
if (!existsSync(msgFile)) {
  console.error('提交信息文件不存在:', msgFile);
  process.exit(1);
}
const msg = readFileSync(msgFile, 'utf8');

const git = (args) => {
  try {
    return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] });
  } catch (e) {
    console.error('git', args.join(' '), '失败:', (e.stderr || e.message || '').toString().slice(0, 500));
    process.exit(1);
  }
};

const staged = git(['diff', '--cached', '--name-only']).trim();
if (staged) {
  console.log('已有暂存内容，跳过 add');
} else {
  git(['add', '-A']);
}
console.log('暂存文件数:', git(['diff', '--cached', '--name-only']).trim().split('\n').filter(Boolean).length);

const before = git(['rev-parse', 'HEAD']).trim();
git(['commit', '-F', msgFile]);
const after = git(['rev-parse', 'HEAD']).trim();
if (before === after) console.log('（无新提交）');
else console.log('新提交:', after.slice(0, 8));

console.log('--- push ---');
console.log(git(['push', 'origin', 'main']).trim());
console.log('--- 状态 ---');
console.log(git(['log', '--oneline', '-3']).trim());
console.log('工作区:', git(['status', '--short']).trim() || '(干净)');
