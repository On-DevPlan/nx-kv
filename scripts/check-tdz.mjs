// TDZ（暂时性死区）静态自查：函数体内「先引用、后声明」的 const。
//
// 为什么值得单独扫：生产构建会把变量名压成单字母，运行时才炸成
// "Cannot access 'Z' before initialization"——lint 与类型检查都抓不到，
// 而且只在打开那个面板时白屏，其它面板照常（错误边界把 blast radius 限住了）。
//
// 规则（保守，宁可漏报不误报）：
//   - 只看函数体内**顶层缩进（2 空格）**的语句行；
//   - 更深缩进的行：默认跳过（那里的引用多在函数体内，延迟求值），
//     但顶层语句的**续行**（多行参数列表、对象字面量、数组字面量）是立即求值的——
//     只要该语句内不含 `=>`/`function`（即没有延迟执行的闭包），续行同样按顶层检查。
//     这条是补出来的：`goalSection({ ..., openGoalLog, ... })` 这种多行调用参数
//     曾在生产里炸成 "Cannot access 'openGoalLog' before initialization"。
//   - 跳过注释与字符串内容（先掩码），跳过成员访问 `.name`、跳过对象键 `name:`。
//   - 每个导出的函数各自独立分析：函数体边界按行首 `}` 定，避免把后一个函数的
//     局部变量算到前一个函数头上。
//
// 误报不了的代价很大（挡住构建），所以规则宁可窄。
//
// 用法：
//   node scripts/check-tdz.mjs <file>   查一个文件
//   node scripts/check-tdz.mjs --all    扫前端所有页面与组件（自动发现，不写死路径）
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

// 把字符串/注释替换成等长空格（保留换行与列号），后续所有匹配都在掩码文本上做，
// 避免把中文注释、模板字符串里的词当成引用。
function maskNonCode(line) {
  let out = '';
  let state = '';
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    const d = line[i + 1];
    if (state === '') {
      if (c === '/' && d === '/') return out + ' '.repeat(line.length - i);
      if (c === '/' && d === '*') { state = 'block'; out += '  '; i++; continue; }
      if (c === "'" || c === '"' || c === '`') { state = c; out += ' '; continue; }
      out += c;
      continue;
    }
    if (state === 'block') {
      if (c === '*' && d === '/') { state = ''; out += '  '; i++; continue; }
      out += ' ';
      continue;
    }
    // 行内字符串：转义吃掉两个字符，遇同类引号收尾
    if (c === '\\') { out += '  '; i++; continue; }
    if (c === state) state = '';
    out += ' ';
  }
  return out;
}

function collectViewFiles(dir, out = []) {
  let entries = [];
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries) {
    const p = join(dir, e.name);
    if (e.isDirectory()) collectViewFiles(p, out);
    else if (e.name.endsWith('.jsx') || e.name.endsWith('.js')) out.push(p);
  }
  return out;
}

// 找出每个顶层导出函数的名字、形参结束行、函数体结束行
function functionRanges(lines) {
  const ranges = [];
  for (let i = 0; i < lines.length; i++) {
    const m = /^export (?:default )?function (\w+)/.exec(lines[i]);
    if (!m) continue;
    // 形参结束行：从函数签名行起数圆括号深度（多行解构参数会跨行）
    let sigEnd = i;
    let paren = 0;
    for (let k = i; k < lines.length; k++) {
      for (const ch of lines[k]) {
        if (ch === '(') paren++;
        else if (ch === ')') paren--;
      }
      if (paren <= 0) { sigEnd = k; break; }
    }
    // 函数体结束：签名之后第一处行首 `}`
    let end = lines.length - 1;
    for (let k = sigEnd + 1; k < lines.length; k++) {
      if (/^}/.test(lines[k])) { end = k; break; }
    }
    ranges.push({ name: m[1], start: i, sigEnd, end });
    i = end;
  }
  return ranges;
}

// 逐文件检查，返回问题列表
function checkFile(file) {
  const lines = readFileSync(file, 'utf8').split('\n');
  const masked = lines.map(maskNonCode);
  const ranges = functionRanges(lines);
  if (!ranges.length) {
    return { file, skipped: true };
  }

  const problems = [];
  const seen = new Set();
  const report = (msg) => {
    if (seen.has(msg)) return;
    seen.add(msg);
    problems.push(msg);
  };

  for (const { name: fnName, sigEnd, end } of ranges) {
    // 函数体内的顶层 const（2 空格缩进）
    const decl = new Map();
    for (let i = sigEnd + 1; i < end; i++) {
      const m = /^ {2}const ([A-Za-z_$][\w$]*)\s*=/.exec(lines[i]);
      if (m && !decl.has(m[1])) decl.set(m[1], i + 1);
    }

    // 规则一：顶层语句行（恰好 2 空格缩进）提前引用
    for (const [name, declLine] of decl) {
      const re = new RegExp('(^|[^\\w.$])' + name + '([^\\w$]|$)');
      for (let i = sigEnd + 1; i < Math.min(declLine - 1, end); i++) {
        const l = lines[i];
        if (!/^ {2}\S/.test(l)) continue;
        if (/^ {2}const /.test(l)) continue;                  // 别的顶层声明
        if (/^\s*\/\//.test(l) || /^\s*\*/.test(l)) continue; // 注释
        if (/^ {2}function\b/.test(l) || /^ {2}\w+\s*=\s*\(/.test(l)) continue; // 顶层函数声明（形参不是引用）
        if (!re.test(l)) continue;
        report(`${fnName}: ${name}（声明在行 ${declLine}）被行 ${i + 1} 提前引用: ${l.trim().slice(0, 90)}`);
        break;
      }
    }

    // 规则二：顶层语句的**续行**（多行参数列表 / 对象字面量 / 数组字面量）同样是立即求值：
    // `goalSection({ ..., openGoalLog, ... })` 里的 openGoalLog 在语句执行那一刻就会被读取。
    // 语句内若含 `=>`/`function`，续行可能落在闭包里（延迟执行），保守跳过整条语句。
    for (let s = sigEnd + 1; s < end; s++) {
      if (!/^ {2}\S/.test(masked[s]) || /^ {2}\//.test(lines[s])) continue;
      let stmtEnd = s;
      let depth = 0;
      for (let i = s; i < end; i++) {
        for (const ch of masked[i]) {
          if (ch === '(' || ch === '[' || ch === '{') depth++;
          else if (ch === ')' || ch === ']' || ch === '}') depth--;
        }
        stmtEnd = i;
        if (depth <= 0) break;
      }
      const hasClosure = /=>|\bfunction\b/.test(masked.slice(s, stmtEnd + 1).join('\n'));
      if (!hasClosure) {
        for (const [name, declLine] of decl) {
          if (declLine <= s + 1) continue; // 只关心「后面才声明」的
          const re = new RegExp('(^|[^\\w.$])' + name + '([^\\w$]|$)');
          for (let i = s; i < Math.min(stmtEnd + 1, declLine - 1); i++) {
            const m = re.exec(masked[i]);
            if (!m) continue;
            if (/^\s*:/.test(masked[i].slice(m.index + m[0].length))) continue; // 对象键，不是引用
            report(`${fnName}: ${name}（声明在行 ${declLine}）被行 ${i + 1} 提前引用: ${lines[i].trim().slice(0, 90)}`);
            break;
          }
        }
      }
      s = stmtEnd;
    }

    // 规则三：useMemo 的依赖数组是**渲染期立即求值**的，依赖里的名字必须先声明。
    // 依赖数组常写在闭括号那一行（`}, [a, b]);`），所以按「含 useMemo 的行往后 6 行内
    // 找形如 [ ... ]); 的依赖列表」来找。
    for (let i = sigEnd + 1; i < end; i++) {
      if (!/useMemo\(/.test(lines[i])) continue;
      let deps = null;
      for (let k = i; k < Math.min(i + 7, end); k++) {
        const m = /\[\s*([^\][]*?)\s*\]\s*\)\s*;?\s*$/.exec(lines[k]);
        if (m && m[1].trim()) { deps = { list: m[1], line: k }; break; }
      }
      if (!deps) continue;
      for (const dep of deps.list.split(',')) {
        const d = dep.trim();
        if (!d || !decl.has(d)) continue;
        const declLine = decl.get(d);
        if (declLine > deps.line) {
          report(`${fnName}: useMemo 的依赖 ${d}（声明在行 ${declLine}）晚于 useMemo 自身（行 ${i + 1}）`);
        }
      }
    }
  }

  return { file, names: ranges.map((r) => r.name), problems, skipped: false };
}

// ---- 分发 ----
const arg = process.argv[2];
if (arg === '--all') {
  // 页面在 frontend/page/，可复用件在 frontend/components/；拆分后的逻辑文件是 .js
  const files = [
    ...collectViewFiles('src/web/frontend/page'),
    ...collectViewFiles('src/web/frontend/components'),
  ];
  const all = [];
  for (const f of files) {
    const r = checkFile(f);
    if (r.skipped) continue;
    if (r.problems.length) all.push(...r.problems.map((p) => `[${f}] ${p}`));
  }
  if (all.length) {
    console.log(all.join('\n'));
    process.exit(1);
  }
  console.log(`OK: ${files.length} 个页面/组件文件里无「先引用后声明」`);
  process.exit(0);
}

const r = checkFile(arg || 'src/web/frontend/page/repos/index.jsx');
if (r.skipped) {
  console.log(`SKIP: ${r.file} 没找到导出的函数`);
  process.exit(0);
}
console.log(
  r.problems.length
    ? r.problems.join('\n')
    : `OK: ${r.file} 的 ${r.names.join(', ')} 体内无「先引用后声明」`
);
process.exit(r.problems.length ? 1 : 0);
