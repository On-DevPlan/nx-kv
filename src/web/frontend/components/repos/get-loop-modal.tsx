// 仓库行「持续 get」（waitgoal）配置弹窗（#145）——原设置面板「项目级设置」里的
// GetLoopEditor 迁来：设置页的项目级区块整 tab 删除，配置落到仓库管理页行内
// 「更多 → 持续 get」，modal 形式配置；行名绿点表示已开启。
//
// 口径不变（#41/#103）：
//   · 一句话即配置——「选模板」（内置默认）+ 带 %s 槽位的一句话（%s = 任务编号，
//     存取时与 {{task.id}} 互转）；多条目手风琴逐条编辑；
//   · 开关即刻落库（收起配置也要能真正开启/关闭，不等保存按钮）；
//   · 落点：仓库登记的 getLoop 字段（repos.ext.ext_getloop），PATCH /api/repos/:id。
import { useState } from 'react';
import { api } from '../../api/client.js';
import { useToast } from '../../components/toast/index.jsx';
import { useApp } from '../../app-context.jsx';
import { Button } from '../../components/button/index.jsx';
import { Modal } from '../../components/popup/index.jsx';
import { PromptItemsEditor } from '../../modules/prompts/prompt-editor.jsx';
import {
  BLOCK_DEFS,
  DEFAULT_GETLOOP_INSTRUCTION,
  normalizeBlockTemplateLists,
} from '../../../../shared/prompt-blocks.js';
import type { RepoGetLoop, RepoRecord } from '../../page/repos/repo-table.js';

// 多条提示词的条数上限（与服务端 clampAckPromptList 一致；settings 同源口径）
const MAX_PROMPT_ITEMS = 10;
const GETLOOP_LINE_MAX = 2000;

// 内置「持续 get」默认内文：**唯一来源在共享层**（src/shared/prompt-blocks.js，
// 服务端渲染内文也用同一份）——此前本文件另存了一份副本，且文案已经落后于服务端。
// 展示层 %s ↔ 存储层 {{task.id}} 互转（其余占位符原样保留）。
const GETLOOP_DEFAULT_PRESET = DEFAULT_GETLOOP_INSTRUCTION.replaceAll('{{task.id}}', '%s');

/** 仓库的 getLoop 配置：除共享的行字段外还带「收尾模板」（历史上有字符串/数组两种落库形态）。 */
interface GetLoopConfig extends RepoGetLoop {
  template?: string | string[] | null;
}

/** 「设置里的提示词模板」列表里的一条。 */
interface LibTemplate {
  id: string;
  name: string;
  template?: string;
  builtin?: boolean;
}

/** 一个区块（context / attachment / getloop…）及其可复用条目。 */
interface LibBlock {
  id: string;
  label: string;
  items: LibTemplate[];
}

export interface GetLoopModalProps {
  /** 仓库记录（含 getLoop） */
  repo: RepoRecord;
  /** 关闭弹窗 */
  onClose: () => void;
  /** 保存成功后的回灌（刷仓库列表） */
  onSaved?: () => void;
}

/**
 * @param {object} repo 仓库记录（含 getLoop）
 * @param {() => void} onClose 关闭弹窗
 * @param {() => void} [onSaved] 保存成功后的回灌（刷仓库列表）
 */
export default function GetLoopModal({ repo, onClose, onSaved }: GetLoopModalProps) {
  const app = useApp();
  const toast = useToast();
  const loop: GetLoopConfig | null = repo.getLoop && typeof repo.getLoop === 'object' ? repo.getLoop : null;
  const [on, setOn] = useState(!!(loop && loop.enabled));
  const [minutes, setMinutes] = useState(String((loop && loop.waitMinutes) || 10));
  // 旧 string 单条归一成一行（按条编辑）；空数组 = 未配置（交付用默认模板）。
  // 展示层 %s ↔ 存储层 {{task.id}} 互转——项目级只写一句话，槽位写 %s。
  const [tpls, setTpls] = useState<string[]>(() => {
    const raw = loop && loop.template;
    const arr = Array.isArray(raw) ? raw : raw == null ? [] : [raw];
    return arr
      .map((s) => String(s ?? '').trim())
      .filter(Boolean)
      .map((s) => s.replaceAll('{{task.id}}', '%s'));
  });
  const [openIdx, setOpenIdx] = useState(-1);
  const [line, setLine] = useState(''); // 一句话输入（可含 %s）
  const [busy, setBusy] = useState(false);
  // 「设置中的提示词模板」选择器：设置页按区块存模板，这里把可复用的条目拉过来，
  // 免得同一段提示词在设置与仓库配置里各写一遍（两边漂移的根源）。
  const [lib, setLib] = useState<{ blocks: LibBlock[] } | null>(null); // { blocks: [{ id, label, items }] } | null
  const [libBusy, setLibBusy] = useState(false);

  const openLib = async () => {
    setLibBusy(true);
    try {
      // 提示词模板存在 localtask 的设置里（面板的提示词模板分区也是这么读的）：
      // GET /api/localtasks → d.settings.blockTemplates。
      const d = await api('/api/localtasks');
      const lists = normalizeBlockTemplateLists(d && d.settings && d.settings.blockTemplates);
      const blocks = BLOCK_DEFS.map((def) => {
        const b = lists[def.id];
        const items = (b?.list || []).map((t) => ({
          id: t.id,
          name: t.name,
          template: t.template,
          builtin: !!t.builtin,
        }));
        return { id: def.id, label: def.label, items };
      }).filter((b) => b.items.length);
      setLib({ blocks });
    } catch (e) {
      toast(String((e as Error).message || e));
    } finally {
      setLibBusy(false);
    }
  };

  // 选中一条设置里的模板 → 填进输入行（仍可再改后再添加）。
  // getloop 区块是**外壳**（输出 {{getloop.text}} 的位置），不是内文——不提供选用。
  const pickTemplate = (tpl: LibTemplate) => {
    const text = String(tpl.template || '').replaceAll('{{task.id}}', '%s');
    setLine(text.slice(0, GETLOOP_LINE_MAX));
    setLib(null);
  };

  const save = async (override?: { enabled?: boolean }) => {
    setBusy(true);
    try {
      const enabled = override && override.enabled !== undefined ? override.enabled : on;
      // %s → {{task.id}}（槽位落库为占位符）；空行丢弃
      const stored = tpls
        .map((s) => String(s ?? '').trim().replaceAll('%s', '{{task.id}}'))
        .filter(Boolean)
        .slice(0, MAX_PROMPT_ITEMS);
      await api('/api/repos/' + encodeURIComponent(repo.id), {
        method: 'PATCH',
        body: {
          getLoop: {
            enabled,
            ...(enabled ? { waitMinutes: Number(minutes) || 10, template: stored } : {}),
          },
        },
      });
      toast(
        enabled
          ? `已保存「${repo.name}」的持续 get 设置（模板 ${stored.length} 条）`
          : `已关闭「${repo.name}」的持续 get`
      );
      if (app.refreshRepos) app.refreshRepos();
      if (onSaved) onSaved();
    } catch (e) {
      toast(String((e as Error).message || e));
    } finally {
      setBusy(false);
    }
  };

  // 开关即刻落库（#103）：不等保存按钮——收着配置也能真正开/关。
  const toggleOn = async (next: boolean) => {
    setOn(next);
    await save({ enabled: next });
  };

  const addLine = () => {
    const v = line.trim();
    if (!v || tpls.length >= MAX_PROMPT_ITEMS) return;
    setTpls([...tpls, v.slice(0, GETLOOP_LINE_MAX)]);
    setOpenIdx(tpls.length); // 新行直接展开
    setLine('');
  };

  return (
    <Modal title={`持续 get · ${repo.name}`} onClose={onClose} size="md">
      <div className="rp-gl">
        <div className="rp-gl-head">
          <div className="rp-gl-title">
            <span className="rp-gl-name">持续 get</span>
            <span className="rp-gl-desc">无任务时阻塞等待新任务回填（waitgoal）</span>
          </div>
          <button
            className={'toggle' + (on ? ' on' : '')}
            onClick={() => toggleOn(!on)}
            disabled={busy}
          >
            <span className="dot" />
            {on ? '开' : '关'}
          </button>
        </div>
        {on && (
          <div className="rp-gl-body">
            <div className="rp-gl-row">
              <span>阻塞窗口</span>
              <span className="rp-gl-unit">
                <input className="rp-gl-min" value={minutes} onChange={(e) => setMinutes(e.target.value)} inputMode="numeric" />
                分钟
              </span>
            </div>
            <div className="rp-gl-tpl">
              <div className="rp-gl-h">收尾模板</div>
              <div className="rp-gl-oneline">
                <Button
                  variant="secondary"
                  title="填入内置默认（继续 get 直到 timeout）"
                  onClick={() => setLine(GETLOOP_DEFAULT_PRESET)}
                >
                  填入内置默认
                </Button>
                <Button
                  variant="secondary"
                  title="从设置 → 提示词模板里挑一条复用（免得同一段话两处各写一遍）"
                  onClick={openLib}
                  disabled={busy || libBusy}
                >
                  {libBusy ? '读取中…' : '从设置中的提示词模板选…'}
                </Button>
                <input
                  className="rp-gl-oneline-input"
                  value={line}
                  placeholder="一句话（%s = 任务编号）"
                  onChange={(e) => setLine(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') addLine();
                  }}
                />
                <Button variant="secondary" disabled={busy || !line.trim()} onClick={addLine}>
                  添加
                </Button>
              </div>
              {lib && (
                <div className="rp-gl-lib">
                  <div className="rp-gl-h">设置里的提示词模板（点击填入输入行，可再改后添加）</div>
                  {lib.blocks.map((b) => (
                    <div className="rp-gl-lib-block" key={b.id}>
                      <span className="rp-gl-lib-label">{b.label}</span>
                      {b.id === 'getloop' ? (
                        <span className="rp-gl-note">
                          持续 get 区块是**外壳**（决定这段话出现在交付的哪个位置），
                          在设置 → 提示词模板 → 持续 get 里编辑；这里配置的是它的内文。
                        </span>
                      ) : (
                        b.items.map((t) => (
                          <button
                            key={t.id}
                            className="rp-gl-lib-item"
                            title={t.template}
                            onClick={() => pickTemplate(t)}
                          >
                            {t.name}
                            {t.builtin ? '（内置）' : ''}
                          </button>
                        ))
                      )}
                    </div>
                  ))}
                  <Button variant="secondary" onClick={() => setLib(null)}>
                    收起
                  </Button>
                </div>
              )}
              {tpls.length ? (
                <PromptItemsEditor
                  items={tpls}
                  onChange={setTpls}
                  disabled={busy}
                  placeholder={'一句话（%s = 任务编号）'}
                  accordion
                  openIndex={openIdx}
                  onOpenChange={setOpenIdx}
                />
              ) : (
                <div className="rp-gl-note">{'未配置模板 —— 用默认「完成后续调 localtask get；没活时每轮最多阻塞 {{getloop.waitMinutes}} 分钟，直到 timeout」。'}</div>
              )}
            </div>
            <div className="rp-gl-acts">
              <Button
                variant="secondary"
                disabled={busy || tpls.length >= MAX_PROMPT_ITEMS}
                title={tpls.length >= MAX_PROMPT_ITEMS ? `最多 ${MAX_PROMPT_ITEMS} 条` : '新增一条「继续 get」指令'}
                onClick={() => {
                  setTpls([...tpls, '']);
                  setOpenIdx(tpls.length);
                }}
              >
                添加一条…
              </Button>
              <span className="spacer" />
              <Button variant="primary" disabled={busy} onClick={() => save()}>保存持续 get 设置</Button>
            </div>
          </div>
        )}
      </div>
    </Modal>
  );
}
