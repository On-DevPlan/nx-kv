// TDZ（暂时性死区）静态自查：组件体内「先引用、后声明」的 const。
//
// 为什么值得单独扫：生产构建会把变量名压成单字母，运行时才炸成
// "Cannot access 'Z' before initialization"——lint 与类型检查都抓不到，
// 而且只在打开那个面板时白屏，其它面板照常（错误边界把 blast radius 限住了）。
//
// 规则（保守，宁可漏报不误报）：
//   - 只看组件函数体内**顶层缩进（2 空格）**的语句行；
//   - 更深缩进的行一律跳过：那里的引用要么在函数体内（延迟求值，安全），
//     要么在 JSX 表达式里（同样延迟到渲染时求值）——
//     真 TDZ 恰恰发生在**顶层**：组件体执行到那一行时变量还没声明。
//   - 跳过注释、跳过别的顶层 const 声明行、跳过形参/解构行。
//
// 误报不了的代价很大（挡住构建），所以规则宁可窄。
import { readFileSync } from 'node:fs';

const file = process.argv[2] || 'src/modules/repos/view.jsx';
const lines = readFileSync(file, 'utf8').split('\n');

// 找组件函数起点：`export default function XxxView() {`
let compStart = -1;
let compName = '';
lines.forEach((l, i) => {
  if (compStart < 0 && /export default function \w+/.test(l)) {
    compStart = i;
    compName = /export default function (\w+)/.exec(l)[1];
  }
});
if (compStart < 0) {
  console.log(`SKIP: ${file} 没找到 default export 组件`);
  process.exit(0);
}

// 组件体内的顶层 const（2 空格缩进）
const decl = new Map();
lines.forEach((l, i) => {
  if (i <= compStart) return;
  const m = /^ {2}const ([A-Za-z_$][\w$]*)\s*=/.exec(l);
  if (m && !decl.has(m[1])) decl.set(m[1], i + 1);
});

const problems = [];
for (const [name, declLine] of decl) {
  const re = new RegExp('(^|[^\\w.$])' + name + '([^\\w$]|$)');
  for (let i = compStart + 1; i < declLine - 1; i++) {
    const l = lines[i];
    // 只看顶层语句行：恰好 2 空格缩进（更深 = 函数体/JSX 表达式，延迟求值）
    if (!/^ {2}\S/.test(l)) continue;
    if (/^ {2}const /.test(l)) continue;                  // 别的顶层声明
    if (/^\s*\/\//.test(l) || /^\s*\*/.test(l)) continue; // 注释
    if (/^ {2}function\b/.test(l) || /^ {2}\w+\s*=\s*\(/.test(l)) continue; // 顶层函数声明（形参不是引用）
    if (!re.test(l)) continue;
    problems.push(`${name}（声明在行 ${declLine}）被行 ${i + 1} 提前引用: ${l.trim().slice(0, 90)}`);
    break;
  }
}

// useMemo 的依赖数组是**渲染期立即求值**的：依赖里的名字必须在 useMemo 之前声明。
// 这一条单独查——它上面的规则会漏掉（依赖数组那行缩进更深）。
// 依赖数组常常写在闭括号那一行（`}, [a, b]);`），所以按「含 useMemo 的行往后 6 行内
// 找形如 [ ... ]); 的依赖列表」来找。
for (let i = compStart; i < lines.length; i++) {
  const l = lines[i];
  if (!/useMemo\(/.test(l)) continue;
  let deps = null;
  for (let k = i; k < Math.min(i + 7, lines.length); k++) {
    const m = /\[\s*([^\][]*?)\s*\]\s*\)\s*;?\s*$/.exec(lines[k]);
    if (m && m[1].trim()) { deps = { list: m[1], line: k }; break; }
  }
  if (!deps) continue;
  for (const dep of deps.list.split(',')) {
    const d = dep.trim();
    if (!d || !decl.has(d)) continue;
    const declLine = decl.get(d);
    if (declLine > deps.line) {
      problems.push(`useMemo 的依赖 ${d}（声明在行 ${declLine}）晚于 useMemo 自身（行 ${i + 1}）`);
    }
  }
}

console.log(
  problems.length
    ? problems.join('\n')
    : `OK: ${file} 的 ${compName} 组件体内无「先引用后声明」`
);
process.exit(problems.length ? 1 : 0);
