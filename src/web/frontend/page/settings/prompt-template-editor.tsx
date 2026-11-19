// 段模板编辑器（#161）：出厂 builtin + 用户条目的多模板管理。
//
// #152 曾把这里改成纯只读（正文进代码）；#161 用户要回编辑能力，但真相结构不变：
//   - builtin 正文仍在插件类里（代码即出厂真相），不可改、只可「复制为新模板」；
//   - 用户条目存 template-store（#238 起落 settings 表，一段一个键 `prompt.tpl.<段>`），保存前走后端白名单校验（坏模板进不来）；
//   - 启用哪条自己挑（activeId），装配时 factory 把启用正文传给插件构造。
//
// 交互模型：editId（正在看的模板）与 activeId（该段当前生效的模板）分离——
// 看 builtin 时显示出厂正文，可复制为用户条目；看用户条目时可改可存可删可启用。
import { useEffect, useState } from 'react';
import { Button } from '../../components/button/index.jsx';
import { useToast } from '../../components/toast/index.jsx';
import {
  activatePromptTemplate,
  deletePromptTemplate,
  savePromptTemplate,
} from './api.js';

/** 某段的用户层模板数据（/api/prompt/registry 的 segmentTemplates[id]）。 */
export interface SegmentTemplates {
  activeId: string;
  items: { id: string; name: string; text: string; createdAt?: number }[];
}

interface EditorProps {
  segment: string;
  label: string;
  /** 出厂正文（插件类 templates[0]，不可改） */
  builtinText: string;
  /** 用户层数据（无记录 = 启用 builtin、无条目） */
  seg: SegmentTemplates | undefined;
  /** 任何落盘成功后回调（主组件刷新注册表） */
  onChanged: () => void;
}

export default function PromptTemplateEditor({ segment, label, builtinText, seg, onChanged }: EditorProps) {
  const toast = useToast();
  const activeId = seg?.activeId || 'builtin';
  const items = seg?.items || [];

  // editId：正在看的模板（'builtin' 或用户条目）；选段/换启用时跟着 active 走
  const [editId, setEditId] = useState<string>(activeId);
  const [editName, setEditName] = useState<string>('');
  const [editText, setEditText] = useState<string>(builtinText);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setEditId(activeId);
  }, [segment, activeId]);

  // editId / 段变化 → 同步编辑框内容（依赖 seg 对象引用：只在刷新后变，不打断打字）
  useEffect(() => {
    if (editId === 'builtin') {
      setEditName('系统内置');
      setEditText(builtinText);
    } else {
      const hit = (seg?.items || []).find((t) => t.id === editId);
      setEditName(hit?.name || '');
      setEditText(hit?.text || '');
    }
    // seg 引用即 items 快照（只在刷新后变，不打断打字）
  }, [editId, segment, builtinText, seg]);

  const isBuiltin = editId === 'builtin';
  const hit = items.find((t) => t.id === editId);
  const editingActive = editId === activeId;

  const guard = (fn: () => Promise<void>) => {
    if (busy) return;
    setBusy(true);
    fn()
      .catch((e) => toast(String((e as Error).message || e)))
      .finally(() => setBusy(false));
  };

  /** 保存：用户条目 = 更新；builtin = 禁止（另存为是唯一出口） */
  const save = () =>
    guard(async () => {
      if (isBuiltin) return;
      await savePromptTemplate({ segment, id: editId, name: editName, text: editText });
      toast('模板已保存（启用中的修改即时生效）');
      onChanged();
    });

  /** 另存为新模板（builtin 的唯一改法；也是「在原本基础上修改」的复制入口） */
  const saveAsNew = () =>
    guard(async () => {
      await savePromptTemplate({ segment, name: editName === '系统内置' ? `${label} · 副本` : editName, text: editText });
      toast('已存为新模板并启用');
      onChanged();
    });

  const activate = (id: string) =>
    guard(async () => {
      await activatePromptTemplate(segment, id);
      toast(id === 'builtin' ? '已切回出厂模板' : '已启用该模板');
      onChanged();
    });

  const remove = () =>
    guard(async () => {
      if (!hit) return;
      await deletePromptTemplate(segment, editId);
      toast('已删除（回落出厂模板）');
      onChanged();
    });

  return (
    <div className='ppt-tpl-mgr'>
      <div className='ppt-tpl-bar'>
        <select
          className='ppt-tpl-select'
          value={editId}
          aria-label={`${label} 的模板选择`}
          onChange={(e) => setEditId(e.target.value)}
        >
          <option value='builtin'>出厂内置{activeId === 'builtin' ? '（启用中）' : ''}</option>
          {items.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
              {activeId === t.id ? '（启用中）' : ''}
            </option>
          ))}
        </select>
        {!isBuiltin && (
          <input
            className='ppt-tpl-name'
            value={editName}
            placeholder='模板名'
            aria-label='模板名'
            onChange={(e) => setEditName(e.target.value)}
          />
        )}
        {isBuiltin ? (
          <Button variant='secondary' disabled={busy} title='以出厂正文为底稿存成一条用户模板（新建即启用）' onClick={saveAsNew}>
            复制为新模板
          </Button>
        ) : (
          <>
            <Button variant='primary' disabled={busy} title='保存这条模板的修改' onClick={save}>
              保存
            </Button>
            <Button variant='secondary' disabled={busy} title='以当前编辑内容为底稿再存一条' onClick={saveAsNew}>
              另存为
            </Button>
            {!editingActive && (
              <Button variant='secondary' disabled={busy} title='让这一段使用这条模板' onClick={() => activate(editId)}>
                启用
              </Button>
            )}
            {editingActive && <span className='ppt-pill is-write'>启用中</span>}
            <Button variant='secondary' disabled={busy} title='删除这条用户模板（回落出厂）' onClick={remove}>
              删除
            </Button>
          </>
        )}
        {isBuiltin && activeId !== 'builtin' && (
          <Button variant='secondary' disabled={busy} title='放弃用户模板，回到出厂正文' onClick={() => activate('builtin')}>
            回出厂
          </Button>
        )}
      </div>

      <textarea
        className='ppt-tpl-area'
        value={editText}
        spellCheck={false}
        aria-label={`${label} 的模板正文${isBuiltin ? '（出厂，只读）' : ''}`}
        readOnly={isBuiltin}
        onChange={(e) => setEditText(e.target.value)}
      />

      <div className='ppt-ro-note'>
        {isBuiltin
          ? '出厂正文在插件类里（modules/promptplug/plugins），这里只读——要改就「复制为新模板」后在副本上编辑。'
          : '保存前会按本段变量白名单校验（引用了不存在的变量会被拒收）。启用中的模板对 get 交付与 CLI 实时生效。'}
      </div>
    </div>
  );
}
