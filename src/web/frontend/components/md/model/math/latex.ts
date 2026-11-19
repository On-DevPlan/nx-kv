// 轻量 LaTeX → HTML 渲染（零依赖，遵循仓库「面板包体保持轻量」的既有取舍）。
//
// 覆盖日常文档够用的子集：矩阵环境（matrix/pmatrix/bmatrix/vmatrix）、分式、
// 根式、上下标、常用希腊字母与运算符、换行。不是完整 TeX——遇到未覆盖的命令
// 退化为原样文本，绝不抛错（渲染器在阅读态高频调用，不能因一条公式白屏）。
//
// 为什么不引 KaTeX：`md-render.ts` 头注释明确不引入第三方解析依赖；KaTeX 会显著
// 增大浏览器包，且 `layering.test.mjs` 要求 web 层依赖可控。这里以「能看懂」为准。

/** HTML 转义（本模块内联一份，避免把渲染器私有 esc 耦进来）。 */
function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    c === '&' ? '&amp;' : c === '<' ? '&lt;' : c === '>' ? '&gt;' : c === '"' ? '&quot;' : '&#39;',
  );
}

/** 常用命令 → Unicode / 结构标记。 */
const SYMBOLS: Record<string, string> = {
  alpha: 'α', beta: 'β', gamma: 'γ', delta: 'δ', epsilon: 'ε', zeta: 'ζ', eta: 'η',
  theta: 'θ', iota: 'ι', kappa: 'κ', lambda: 'λ', mu: 'μ', nu: 'ν', xi: 'ξ', pi: 'π',
  rho: 'ρ', sigma: 'σ', tau: 'τ', phi: 'φ', chi: 'χ', psi: 'ψ', omega: 'ω',
  Gamma: 'Γ', Delta: 'Δ', Theta: 'Θ', Lambda: 'Λ', Xi: 'Ξ', Pi: 'Π', Sigma: 'Σ',
  Phi: 'Φ', Psi: 'Ψ', Omega: 'Ω',
  times: '×', div: '÷', cdot: '·', pm: '±', mp: '∓',
  le: '≤', leq: '≤', ge: '≥', geq: '≥', ne: '≠', neq: '≠', approx: '≈', equiv: '≡',
  infty: '∞', sum: '∑', prod: '∏', int: '∫', partial: '∂', nabla: '∇',
  to: '→', rightarrow: '→', leftarrow: '←', leftrightarrow: '↔', Rightarrow: '⇒',
  cdots: '⋯', ldots: '…', dots: '…', quad: ' ', qquad: '  ',
};

const MATRIX_ENVS = ['matrix', 'pmatrix', 'bmatrix', 'vmatrix', 'Bmatrix'];

/** 把矩阵环境渲染成可排列的行列结构（CSS 负责括号与网格）。 */
function renderMatrix(env: string, body: string): string {
  const rows = body
    .split(/\\\\/)
    .map((r) => r.trim())
    .filter((r) => r.length);
  const rowHtml = rows
    .map(
      (r) =>
        '<span class="md-mrow">' +
        r
          .split('&')
          .map((c) => `<span class="md-mcell">${renderLatex(c.trim())}</span>`)
          .join('') +
        '</span>',
    )
    .join('');
  return `<span class="md-matrix md-matrix-${env}">${rowHtml}</span>`;
}

/** 递归渲染一段 LaTeX（已假定非矩阵部分）。 */
export function renderLatex(src: string): string {
  let s = String(src ?? '');

  // 1) 矩阵环境先抽成占位符（其 HTML 不能再被后续 esc 二次转义）
  const matrixHtml: string[] = [];
  for (const env of MATRIX_ENVS) {
    const re = new RegExp(`\\\\begin\\{${env}\\}([\\s\\S]*?)\\\\end\\{${env}\\}`, 'g');
    s = s.replace(re, (_m, body: string) => {
      matrixHtml.push(renderMatrix(env, body));
      return `\u0001${matrixHtml.length - 1}\u0001`;
    });
  }

  // 2) 转义剩余文本（占位符是控制字符，不受影响），再做结构替换
  s = esc(s);

  // 3) 分式（迭代展开，支持一层嵌套分母/分子里的简单花括号）
  for (let k = 0; k < 6; k++) {
    const before = s;
    s = s.replace(
      /\\frac\{([^{}]*)\}\{([^{}]*)\}/g,
      '<span class="md-frac"><span class="md-frac-num">$1</span><span class="md-frac-den">$2</span></span>',
    );
    if (s === before) break;
  }

  // 4) 根式
  s = s.replace(/\\sqrt\{([^{}]*)\}/g, '<span class="md-sqrt">√<span class="md-sqrt-x">$1</span></span>');

  // 5) 上下标：{...} 与单字符两种
  s = s.replace(/\^\{([^{}]*)\}/g, '<sup>$1</sup>').replace(/\^(\w)/g, '<sup>$1</sup>');
  s = s.replace(/_\{([^{}]*)\}/g, '<sub>$1</sub>').replace(/_(\w)/g, '<sub>$1</sub>');

  // 6) 希腊字母 / 运算符
  s = s.replace(/\\([A-Za-z]+)/g, (m, name: string) => (SYMBOLS[name] !== undefined ? SYMBOLS[name] : m));

  // 7) 间距与换行收尾
  s = s.replace(/\\[,;:]|\\ |\\!/g, ' ').replace(/\\\\/g, '<br>').replace(/\n/g, '<br>');

  // 8) 还原矩阵 HTML（占位符 → 已渲染结构）
  s = s.replace(/\u0001(\d+)\u0001/g, (_m, n: string) => matrixHtml[Number(n)] ?? '');
  return s;
}

/** 归一：去掉公式两端的 `$` / `$$` / `\(` `\)` / `\[` `\]` 包裹。 */
export function stripMathDelims(raw: string): string {
  const s = String(raw ?? '').trim();
  if (s.startsWith('$$') && s.endsWith('$$')) return s.slice(2, -2).trim();
  if (s.startsWith('$') && s.endsWith('$')) return s.slice(1, -1).trim();
  if (s.startsWith('\\[') && s.endsWith('\\]')) return s.slice(2, -2).trim();
  if (s.startsWith('\\(') && s.endsWith('\\)')) return s.slice(2, -2).trim();
  return s;
}
