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

// 多条提示词的条数上限（与服务端 clampAckPromptList 一致；settings 同源口径）
const MAX_PROMPT_ITEMS = 10;
const GETLOOP_LINE_MAX = 2000;

// 内置「持续 get」默认模板的预设文案（与服务端 waitgoal-config 默认同文案；%s = 任务编号，
// 存取时与 {{task.id}} 互转）。服务端常量带 core 依赖，前端本地声明。
const GETLOOP_DEFAULT_PRESET =
  '不要直接结束本轮：完成上面的任务（%s）之后，继续调用 nx-kv localtask get（带 --summary 当前现状）领取下一条任务，直到 get 返回 timeout 为止。';

/**
 * @param {object} repo 仓库记录（含 getLoop）
 * @param {() => void} onClose 关闭弹窗
 * @param {() => void} [onSaved] 保存成功后的回灌（刷仓库列表）
 */
export default function GetLoopModal({ repo, onClose, onSaved }) {
  const app = useApp() || {};
  const toast = useToast();
  const loop = repo.getLoop && typeof repo.getLoop === 'object' ? repo.getLoop : null;
  const [on, setOn] = useState(!!(loop && loop.enabled));
  const [minutes, setMinutes] = useState(String((loop && loop.waitMinutes) || 10));
  // 旧 string 单条归一成一行（按条编辑）；空数组 = 未配置（交付用默认模板）。
  // 展示层 %s ↔ 存储层 {{task.id}} 互转——项目级只写一句话，槽位写 %s。
  const [tpls, setTpls] = useState(() => {
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

  const save = async (override) => {
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
      app.refreshRepos && app.refreshRepos();
      onSaved && onSaved();
    } catch (e) {
      toast(String(e.message || e));
    } finally {
      setBusy(false);
    }
  };

  // 开关即刻落库（#103）：不等保存按钮——收着配置也能真正开/关。
  const toggleOn = async (next) => {
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
