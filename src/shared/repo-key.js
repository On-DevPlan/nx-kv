// 仓库 key 的纯函数（shared 层）：
//   normalizeKey   任意 key 写法的归一化
//   keyFromRemote  远程地址 → 仓库 key
//
// 放在 shared 是为了让**前端**（添加/编辑仓库时的自动填充）与后端（登记/导入）
// 共用同一份口径；web 不能依赖 core，但可以依赖 shared。

// 自定义 key 归一：允许中文与 `/`（像命名空间），其余空白/非法字符压成 -。
// 空 key 不合法——key 是身份，不能空（由调用方校验）。
export function normalizeKey(k) {
  const s = String(k || '')
    .trim()
    .replace(/\s+/g, '-')
    .replace(/[<>:"\\|?*\x00-\x1f]/g, '-')
    .replace(/\.git$/i, '')
    .replace(/\/{2,}/g, '/')
    .replace(/^\/+|\/+$/g, '')
    .slice(0, 160);
  return s.toLowerCase();
}

// 远程地址 → 仓库 key（纯函数）。同一仓库的 N 种写法必须归一成同一个 key：
//   git@host:path                         → host/path
//   ssh://[user@]host[:port]/path        → host/path
//   http(s)://[user@]host[:port]/path    → host/path
//   file:///abs/path 或 file://D:/path   → 去协议/盘符后的路径
// 之后统一：去 user/端口、去尾 /、去 .git、host 别名（ssh|www.github.com → github.com）、小写。
export function keyFromRemote(url) {
  let s = String(url || '').trim();
  if (!s) return '';
  s = s.replace(/\/+$/, '');
  // git@host:path（scp 语法）
  const scp = /^git@([^:/]+):(.+)$/i.exec(s);
  if (scp) s = scp[1] + '/' + scp[2];
  else if (/^[a-z][a-z0-9+.-]*:\/\//i.test(s)) {
    // 有协议的：剥协议 → [user@]host[:port]/path
    s = s.replace(/^[a-z][a-z0-9+.-]*:\/\//i, '');
    s = s.replace(/^[^/]*@/, '');        // 丢 user@
    s = s.replace(/^([^/]+?):\d+(\/|$)/, '$1$2'); // 丢 :port（只认紧跟 host 的那个冒号）
    // file:///D:/path 这类本地 URL：盘符冒号也要丢（key 里不允许 `:`——
    // normalizeKey 会把它压成 -，两边不一致就会「登记的是 A、成员表里是 B」）
    s = s.replace(/^([a-z]):/i, '$1');
  }
  s = s.replace(/\.git$/i, '');
  s = s.replace(/\/{2,}/g, '/');
  const hostAlias = { 'ssh.github.com': 'github.com', 'www.github.com': 'github.com' };
  const slash = s.indexOf('/');
  if (slash > 0) {
    const host = s.slice(0, slash).toLowerCase();
    s = (hostAlias[host] || host) + s.slice(slash);
  }
  // 去首尾斜杠：file:///tmp/x 剥协议后是 "/tmp/x"，带前导斜杠的话同一份数据在
  // 「派生」与「归一」两条路上会算出不同的 key（/tmp/x vs tmp/x）——
  // 表现为「登记的是 A、成员表里是 B」，关系连不上。
  s = s.replace(/^\/+|\/+$/g, '');
  return s.toLowerCase();
}
