// 分组管理（弹窗）：分组是筛选维度与「思考模型」，维护动作不需要占主版面。
// 每行 = 组名 + 成员 + 组介绍文档 + 操作；新建 / 编辑 / 导入 / 导出也收在这里。
//
// 看板只存引用 → **加入分组是复制**，不是移动：同一个仓库可以同时在多个
// 分组里；取消某份副本只摘那个分组的引用，仓库本体纹丝不动。
import { useState } from 'react';
import type { ChangeEvent } from 'react';
import { createBoard, deleteBoard, exportBoards, importBoards, updateBoard } from './api.js';
import { useGuard, useToast } from '../../components/toast/index.jsx';
import { useDialog, Modal } from '../../components/popup/index.jsx';
import { Button } from '../../components/button/index.jsx';
import type { BoardMember, BoardRecord, ReposReload } from './repo-table.js';

/** 新建 / 编辑看板的表单（id=null 表示新建）。 */
interface BoardForm {
  id: string | null;
  name: string;
  desc: string;
}

export default function BoardAdminModal({ boardList, unassigned, onClose, onFilter, onMembers, onOpenDoc, reload }: {
  boardList: BoardRecord[];
  unassigned?: BoardMember[];
  onClose: () => void;
  onFilter: (id: string) => void;
  onMembers: (boardId: string) => void;
  onOpenDoc: (b: BoardRecord) => void;
  reload: ReposReload;
}) {
  const guard = useGuard();
  const toast = useToast();
  const { dialog, node: dialogNode } = useDialog();
  const [boardForm, setBoardForm] = useState<BoardForm | null>(null); // null | { id?, name, desc }
  const [impOpen, setImpOpen] = useState(false);
  const [impText, setImpText] = useState('');
  const [expText, setExpText] = useState<string | null>(null);

  const saveBoard = () => guard(async () => {
    // 表单只在 boardForm 非空时渲染（见下方弹窗），这里只是收窄
    if (!boardForm) return;
    const body: { name: string; desc?: string } = { name: boardForm.name.trim() };
    if (!body.name) return;
    // 描述是文档：编辑时不再提交 desc（领域描述在组介绍文档里写）；
    // 新建时给的那段仍是「初始正文」，之后在组介绍文档里继续维护
    if (!boardForm.id) body.desc = boardForm.desc.trim() || undefined;
    if (boardForm.id) await updateBoard(encodeURIComponent(boardForm.id), body);
    else await createBoard(body);
    setBoardForm(null);
    await reload.boards();
  });

  const removeBoard = (b: BoardRecord) => guard(async () => {
    const ok = await dialog({
      message: `删看板「${b.name}」？它里面的 ${(b.repos || []).length} 个仓库**仍留在中心清单里**（只是少了一份归属）。`,
      danger: true,
    });
    if (!ok) return;
    await deleteBoard(encodeURIComponent(b.id));
    await Promise.all([reload.repos(), reload.boards()]);
  });

  const doImport = () => guard(async () => {
    if (!impText.trim()) return;
    const r = await importBoards({ json: impText });
    setImpOpen(false);
    setImpText('');
    toast(`已导入：新建 ${r.created} 个看板、合并 ${r.merged} 个、匹配仓库 ${r.matched} 个`
      + (r.unmatched.length ? `；未匹配 ${r.unmatched.length} 条（见 CLI board import 输出）` : ''));
    await Promise.all([reload.repos(), reload.boards()]);
  });

  const doExport = () => guard(async () => {
    const r = await exportBoards();
    setExpText(JSON.stringify(r, null, 2));
  });

  const readImpFile = async (e: ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;
    setImpText(await f.text());
  };

  return (
    <Modal size="wide" title={`分组管理 · ${boardList.length}`} onClose={onClose}>
      <div className="rp-modal-bar">
        <span className="acts">
          <Button small onClick={() => setBoardForm({ id: null, name: '', desc: '' })}>新建分组</Button>
          <Button small title="粘贴/选择看板 JSON" onClick={() => setImpOpen(true)}>导入</Button>
          <Button small title="导出全部看板为 JSON" onClick={doExport}>导出</Button>
        </span>
        <span className="muted">一个分组 = 一个主题；同一个仓库可以同时在多个分组里。</span>
      </div>
      {boardList.length ? (
        <div className="rp-board-admin">
          <div className="rp-board-admin-head">
            <span>分组</span><span>成员</span><span>组介绍</span><span>操作</span>
          </div>
          {boardList.map((b) => {
            const members = (b.repos || []).filter((m) => m.present !== false);
            const missing = (b.repos || []).filter((m) => m.present === false);
            return (
              <div className="rp-board-admin-row" key={b.id}>
                <span className="rp-board-admin-name">
                  {b.name}
                  <button
                    className="rp-mini-link"
                    title={`只看「${b.name}」里的仓库`}
                    onClick={() => { onFilter(b.id); onClose(); }}
                  >
                    筛选
                  </button>
                </span>
                <span className="rp-board-admin-members">
                  {members.slice(0, 4).map((m) => (
                    <span className="rp-board-mchip" key={m.key} title={m.note || m.key}>{m.name || m.key}</span>
                  ))}
                  {members.length > 4 ? <span className="rp-board-more">+{members.length - 4}</span> : null}
                  {missing.length ? <span className="rp-board-missing">{missing.length} 待初始化</span> : null}
                  {!(b.repos || []).length ? <span className="muted">—</span> : null}
                </span>
                <span className="rp-board-admin-doc">
                  <Button small title="在右侧栏列出这个组的文档"
                    onClick={() => onOpenDoc(b)}>文档</Button>
                  {b.docCount && b.docCount > 1 ? <span className="muted">+{b.docCount - 1}</span> : null}
                </span>
                <span className="rp-board-admin-acts">
                  <a className="btn small ghost" href={'#/group/' + encodeURIComponent(b.id)} title="组页：成员与任务">组页 ↗</a>
                  <Button small onClick={() => onMembers(b.id)}>成员</Button>
                  <Button small onClick={() => setBoardForm({ id: b.id, name: b.name, desc: b.desc || '' })}>编辑</Button>
                  <Button small danger onClick={() => removeBoard(b)}>删除</Button>
                </span>
              </div>
            );
          })}
          {unassigned?.length ? (
            <div className="rp-boards-unassigned">
              未分组 <b>{unassigned.length}</b> 个 —— 不属于任何分组，只在「全部」里可见。
            </div>
          ) : null}
        </div>
      ) : (
        <div className="rp-board-empty muted">
          还没有分组 —— 点「新建分组」建一个当主题用（如「前端」「AI 工具」），再把仓库点选进去。
        </div>
      )}

      {/* 新建 / 编辑看板弹窗 */}
      {boardForm ? (
        <Modal title={boardForm.id ? '编辑看板' : '新建看板'} onClose={() => setBoardForm(null)}>
          <div className="form-grid">
            <div className="form-field">
              <label htmlFor="bd-name">看板名称 *</label>
              <input
                id="bd-name"
                placeholder="如 前端 / AI 工具"
                value={boardForm.name}
                onChange={(e) => setBoardForm((f) => (f ? { ...f, name: e.target.value } : f))}
              />
            </div>
            {boardForm.id ? (
              <div className="form-field">
                <label>领域描述（文档）</label>
                <div className="rp-docpick">
                  <button
                    type="button"
                    className={'rp-doc' + (boardForm.desc ? '' : ' ghost')}
                    title="打开右侧栏文档列表（组介绍在里面维护）"
                    onClick={() => {
                      const b = boardList.find((x) => x.id === boardForm?.id);
                      setBoardForm(null);
                      if (b) onOpenDoc(b);
                    }}
                  >
                    {boardForm.desc || '未写'}
                  </button>
                </div>
              </div>
            ) : (
              <div className="form-field">
                <label htmlFor="bd-desc">初始描述</label>
                <textarea
                  id="bd-desc"
                  rows={3}
                  spellCheck="false"
                  placeholder={'新建时给的介绍正文（之后在组介绍文档里继续维护）。\n如：这组仓库在这个环境里的侧重、配合关系、关键路径与搜索关键词。'}
                  value={boardForm.desc}
                  onChange={(e) => setBoardForm((f) => (f ? { ...f, desc: e.target.value } : f))}
                />
              </div>
            )}
            <div className="form-acts">
              <Button  onClick={() => setBoardForm(null)}>取消</Button>
              <Button  disabled={!boardForm.name.trim()} onClick={saveBoard}>
                {boardForm.id ? '保存' : '新建看板'}
              </Button>
            </div>
          </div>
        </Modal>
      ) : null}

      {/* 导入看板弹窗 */}
      {impOpen ? (
        <Modal title="导入看板 JSON" size="lg" onClose={() => { setImpOpen(false); setImpText(''); }}>
          <div className="form-grid">
            <div className="form-field">
              <label htmlFor="bd-imp">看板 JSON</label>
              <div className="form-hint">
                结构 {'{ boards:[{ name, repos:[{ path|name }] }] }'} —— 按 path 或 name 匹配已登记仓库，匹配不上的会如实报告
              </div>
              <input
                id="bd-imp-file"
                type="file"
                accept=".json,application/json"
                onChange={readImpFile}
              />
              <textarea
                id="bd-imp"
                rows={10}
                spellCheck="false"
                placeholder='{"boards":[{"name":"前端","repos":[{"path":"D:/code/a_js/proj/nx-ft"}]}]}'
                value={impText}
                onChange={(e) => setImpText(e.target.value)}
              />
            </div>
            <div className="form-acts">
              <Button  onClick={() => { setImpOpen(false); setImpText(''); }}>取消</Button>
              <Button  disabled={!impText.trim()} onClick={doImport}>导入</Button>
            </div>
          </div>
        </Modal>
      ) : null}

      {/* 导出结果 */}
      {expText ? (
        <Modal title="看板 JSON（可回灌给导入）" size="lg" onClose={() => setExpText(null)}>
          <textarea className="bd-exp" rows={14} readOnly value={expText} spellCheck="false" />
        </Modal>
      ) : null}

      {dialogNode}
    </Modal>
  );
}
