// 添加 / 编辑仓库弹窗。
//
// key 只允许两个来源：用户填的，或远程地址归一化。两样都没有就不许保存。
// key 是否被用户手动改过：没改过时跟随远程地址自动填充；改过就不再被覆盖。
// 这不仅影响 UI，也决定提交时发不发 key —— 发 key 等于「固化为自定义」。
//
// 「项目描述」不是一段字符串，是绑定的文档集：这里只显示主篇入口（点开即编辑），
// 补充篇在文档页里管理。新建时还没有文档，等落地后从行内点进去写。
import { useEffect, useMemo, useState } from 'react';
import type { ChangeEvent } from 'react';
import { api } from '../../api/client.js';
import { useGuard, useToast } from '../../components/toast/index.jsx';
import { useDialog, Modal } from '../../components/popup/index.jsx';
import { Button } from '../../components/button/index.jsx';
import { useWikiNav } from '../doc/index.jsx';
// key 归一化与后端共用同一份纯函数（shared/repo-key.js 无 Node 依赖，可直接进前端包），
// 避免面板里显示/自动填充的 key 和后端登记时算出来的 key 不一致。
import { keyFromRemote, normalizeKey } from '../../../../shared/repo-key.js';
import type { RepoRecord } from './repo-table.js';

const EMPTY_FORM = { path: '', name: '', desc: '', notes: '', type: 'dev', remote: '', key: '', icon: '' };

/** 表单字段（与 EMPTY_FORM 同形）。 */
type RepoForm = typeof EMPTY_FORM;

/** /api/repos/detect 的探测结果（loading / error 是本地的阶段态）。 */
interface DetectState {
  loading?: boolean;
  error?: string;
  recommended?: string;
  key?: string;
  remotes?: { name?: string; url?: string }[];
  exists?: boolean;
  isGit?: boolean;
}

/** 提交体：key / keyCustom 只在特定分支出现（见 submit 的注释）。 */
interface RepoBody {
  path: string;
  name?: string;
  notes: string;
  type: string;
  remote?: string;
  icon: string;
  key?: string;
  keyCustom?: boolean;
}

export default function RepoFormModal({ editing, repos, onClose, onSaved }: {
  editing?: string | null;
  repos: RepoRecord[];
  onClose: () => void;
  onSaved: () => void | Promise<void>;
}) {
  const guard = useGuard();
  const toast = useToast();
  const { dialog, node: dialogNode } = useDialog();
  const { openByDocId } = useWikiNav();
  const editingRepo = useMemo(
    () => (editing ? repos.find((x) => x.id === editing) || null : null),
    [editing, repos],
  );
  const [form, setForm] = useState<RepoForm>(() => (editingRepo ? {
    path: editingRepo.path || '',
    name: editingRepo.name || '',
    desc: editingRepo.desc || '',
    type: editingRepo.type || 'dev',
    remote: editingRepo.remote || '',
    notes: editingRepo.notes || '',
    key: editingRepo.key || '',
    icon: editingRepo.icon || '',
  } : EMPTY_FORM));
  // 自定义 key 打开即视为「用户声明过」，编辑远程地址时不自动覆盖它；
  // 非自定义 key 仍跟着远程地址走（和编辑前行为一致）。
  const [keyManual, setKeyManual] = useState(() => (editingRepo ? editingRepo.keyCustom === true : false));
  // 登记前探测：填完路径问一次 git remote
  //   null | { loading } | { exists, isGit, recommended, key, remotes } | { error }
  const [detect, setDetect] = useState<DetectState | null>(null);
  // 远程地址是否被人改过：改过就不再用探测结果覆盖（编辑已有仓库时开箱为 true）
  const [remoteManual, setRemoteManual] = useState(() => !!editingRepo);

  // 填完路径自动问一次 git remote（400ms 防抖）；只在「远程地址没人动过」时覆盖，
  // 用户手填/编辑旧仓库时一律不动。目录不存在/不是 git/没 remote 只提示，不猜地址。
  useEffect(() => {
    const p = form.path.trim();
    if (!p) { setDetect(null); return undefined; }
    let alive = true;
    const timer = setTimeout(async () => {
      setDetect({ loading: true });
      try {
        const d = await api('/api/repos/detect', { method: 'POST', body: { path: p } });
        if (!alive) return;
        setDetect({ loading: false, ...d });
        if (d.recommended && !remoteManual) {
          setForm((f) => ({ ...f, remote: d.recommended, key: keyManual ? f.key : (d.key || f.key) }));
        }
      } catch (e) {
        if (alive) setDetect({ loading: false, error: (e as Error).message });
      }
    }, 400);
    return () => { alive = false; clearTimeout(timer); };
  }, [form.path, remoteManual, keyManual]);

  const set = (k: keyof RepoForm) => (e: ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => setForm((f) => ({ ...f, [k]: e.target.value }));
  // 远程地址变化时，只要用户没手动改过 key，就把归一化结果同步到 key 输入框。
  // 判定「没改过」= keyManual=false；这样粘贴 SSH/HTTPS 任一写法都会自动得到
  // github.com/owner/repo 这种统一 key，用户仍可再改。
  const setRemote = (e: ChangeEvent<HTMLInputElement>) => {
    const remote = e.target.value;
    setRemoteManual(true);
    setDetect(null);
    setForm((f) => ({ ...f, remote, key: keyManual ? f.key : keyFromRemote(remote) }));
  };
  const setKey = (e: ChangeEvent<HTMLInputElement>) => {
    setKeyManual(true);
    setForm((f) => ({ ...f, key: e.target.value }));
  };

  // 编辑弹窗里的「项目描述」= 这个仓库绑定的文档集（主篇 + 补充篇），不给字符串输入框
  const editingDocs = (editingRepo && editingRepo.descDocs) || null;

  const submit = () => guard(async () => {
    if (!form.path.trim()) return;
    const remote = form.remote.trim();
    const rawKey = form.key.trim();
    const nextKey = rawKey ? normalizeKey(rawKey) : keyFromRemote(remote);
    if (!nextKey) {
      toast('仓库 key 必填：没有远程 git 地址时必须手工填写 key（不会再自动生成 local/<目录名>）');
      return;
    }
    const body: RepoBody = {
      path: form.path.trim(),
      name: form.name.trim() || undefined,
      notes: form.notes,
      type: form.type === 'ref' ? 'ref' : 'dev',
      remote: remote || undefined,
      // 图标（emoji / 单字符；清空 = 回默认文件夹图标）——原设置页「项目级设置」
      // 的编辑入口（#145 删除该 tab）迁到这里
      icon: form.icon.trim(),
    };
    if (editing) {
      const origKey = (editingRepo && editingRepo.key) || '';
      if (keyManual && rawKey === '') {
        // 清空 key = 放弃自定义，回到「跟随远程地址」；没有远程地址就没有身份可用。
        if (!remote) {
          toast('清空自定义 key 需要仓库有远程地址（否则 key 必填）');
          return;
        }
        body.key = '';
        body.keyCustom = false;
      } else if (keyManual && nextKey !== origKey) {
        // 改 key 是改身份：关系表会级联，但磁盘上的文档目录不会自己搬家。
        const ok = await dialog({
          title: '修改仓库 key',
          message: `key 是仓库身份，改掉会连锁影响：\n\n「${origKey || '(空)'}」→「${nextKey}」\n\n队列/看板/参考关系会跟随新 key 级联更新；docs/ 下按旧 key 生成的文档路径不会自动迁移，需要手动处理。确认修改？`,
          danger: true,
        });
        if (!ok) return;
        body.key = nextKey;
        body.keyCustom = true;
      }
      // 没手动改 key：不发 key。后端在 remote 变化且非自定义时会自动重算。
    } else {
      body.key = nextKey;
      if (keyManual) body.keyCustom = true;
    }
    if (editing) await api(`/api/repos/${encodeURIComponent(editing)}`, { method: 'PATCH', body });
    else await api('/api/repos', { method: 'POST', body });
    onClose();
    await onSaved();
  });

  return (
    <Modal title={editing ? `编辑仓库 · ${editing}` : '添加仓库'} onClose={onClose}>
      <div className="form-grid">
        <div className="form-field">
          <label htmlFor="repo-path">仓库绝对路径 *</label>
          <input id="repo-path" placeholder="D:/code/my-project" spellCheck="false" value={form.path} onChange={set('path')} />
        </div>
        <div className="form-field">
          <label htmlFor="repo-name">名称</label>
          <input id="repo-name" placeholder="留空则用目录末段" value={form.name} onChange={set('name')} />
        </div>
        <div className="form-field">
          <label htmlFor="repo-icon">图标</label>
          <input id="repo-icon" maxLength={8} placeholder="emoji 或单字符（留空 = 默认文件夹图标）"
            value={form.icon} onChange={set('icon')} />
        </div>
        {editingDocs ? (
          <div className="form-field">
            <label>项目描述（文档）</label>
            <div className="rp-docpick">
              <button type="button" className="rp-doc" onClick={() => { onClose(); openByDocId(editingDocs.main?.docId); }}>
                {editingDocs.main?.title}
                {editingDocs.main?.exists ? null : <span className="rp-doc-todo">未写</span>}
              </button>
              {(editingDocs.links || []).length ? (
                <span className="muted">另有 {(editingDocs.links || []).length} 篇补充文档</span>
              ) : null}
            </div>
          </div>
        ) : null}
        <div className="form-field">
          <label htmlFor="repo-type">类型</label>
          <select id="repo-type" value={form.type} onChange={set('type')}>
            <option value="dev">开发仓库（本机开发的）</option>
            <option value="ref">参考仓库（远程 clone 下来的）</option>
          </select>
        </div>
        <div className="form-field">
          <label htmlFor="repo-remote">远程 git 地址</label>
          <input id="repo-remote" spellCheck="false" placeholder="https://github.com/me/x.git（导出时导它，不含本地路径）"
            value={form.remote} onChange={setRemote} />
          {detect ? (
            <div className="form-hint">
              {detect.loading ? '正在从目录读取 git remote…'
                : detect.error ? `读取 git remote 失败：${detect.error}`
                : detect.recommended
                  ? `已按目录 git remote 自动填入${(detect.remotes || []).length > 1 ? `（另有 ${(detect.remotes || []).length - 1} 条候选）` : ''}`
                  : detect.exists === false ? '该路径不存在 —— 请检查后重填'
                  : detect.isGit ? '目录是 git 仓库，但没有配置 remote —— 请手工填写'
                  : '目录不是 git 仓库 —— 请手工填写'}
            </div>
          ) : null}
          <div className="form-hint">
            有远程地址时，下面的 key 会按它自动归一化：ssh / https / 带 .git / 带 user 的写法
            都归一成 host/owner/repo（如 github.com/on-devplan/nx-kv）。
          </div>
        </div>
        <div className="form-field">
          <label htmlFor="repo-key">仓库 key *（全局唯一身份）</label>
          <input id="repo-key" spellCheck="false" placeholder="github.com/on-devplan/nx-kv"
            value={form.key} onChange={setKey} />
          <div className="form-hint">
            没有远程地址时必须手工填写；已有仓库可查看，改 key 会波及引用它的队列 / 看板 / 关系。
          </div>
        </div>
        <div className="form-field">
          <label htmlFor="repo-notes">备注</label>
          <textarea id="repo-notes" placeholder="补充信息（可选）" value={form.notes} onChange={set('notes')} />
        </div>
        <div className="form-acts">
          <Button  onClick={onClose}>取消</Button>
          <Button  disabled={!form.path.trim() || (!form.key.trim() && !form.remote.trim())} onClick={submit}>
            {editing ? '保存修改' : '添加仓库'}
          </Button>
        </div>
      </div>
      {dialogNode}
    </Modal>
  );
}
