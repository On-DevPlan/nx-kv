// 仓库行「持续 get」（waitgoal）配置弹窗（#145）——原设置面板「项目级设置」里的
// GetLoopEditor 迁来：设置页的项目级区块整 tab 删除，配置落到仓库管理页行内
// 「更多 → 持续 get」，modal 形式配置；行名绿点表示已开启。
//
// **#182 起只留「开关 + 阻塞分钟」**：
//   · 交付里那段「继续 get」的**文案**不在这里配——它是全局的，只有一份，
//     归 设置 → 提示词模板 → 持续 get 区块（此前这里还能按仓库写一份 template，
//     与全局模板各写一遍必然漂移，那个口子已下线）；
//   · 开关即刻落库（收起配置也要能真正开启/关闭，不等保存按钮）；
//   · 落点：仓库登记的 getLoop 字段（repos.ext.ext_getloop），PATCH /api/repos/:id。
import { useState } from 'react';
import { useToast } from '../../components/toast/index.jsx';
import { useApp } from '../../app-context.jsx';
import { Button } from '../../components/button/index.jsx';
import { Modal } from '../../components/popup/index.jsx';
import { updateRepo } from '../../page/repos/api.js';
import type { RepoRecord } from '../../page/repos/repo-table.js';

/** 阻塞窗口的兜底值（与服务端 GET_LOOP_DEFAULT_MINUTES 同口径）。 */
const DEFAULT_MINUTES = 10;

export interface GetLoopModalProps {
  /** 仓库记录（含 getLoop） */
  repo: RepoRecord;
  /** 关闭弹窗 */
  onClose: () => void;
  /** 保存成功后的回灌（刷仓库列表） */
  onSaved?: () => void;
}

export default function GetLoopModal({ repo, onClose, onSaved }: GetLoopModalProps) {
  const app = useApp();
  const toast = useToast();
  const loop = repo.getLoop && typeof repo.getLoop === 'object' ? repo.getLoop : null;
  const [on, setOn] = useState(!!(loop && loop.enabled));
  // #112：0 是合法值（= 不设项目级窗口，沿用 get 的默认阻塞），不能被 `|| 默认值` 吞掉
  const [minutes, setMinutes] = useState(
    loop && loop.waitMinutes !== undefined && loop.waitMinutes !== null ? String(loop.waitMinutes) : String(DEFAULT_MINUTES)
  );
  const [busy, setBusy] = useState(false);

  /** 输入框 → 落库值：空/非法回落默认；0 原样保留（#112）。 */
  const minutesOf = (raw: string): number => {
    const s = String(raw ?? '').trim();
    if (s === '') return DEFAULT_MINUTES;
    const n = Number(s);
    return Number.isFinite(n) && n >= 0 ? Math.min(Math.floor(n), 600) : DEFAULT_MINUTES;
  };

  const save = async (override?: { enabled?: boolean }) => {
    setBusy(true);
    try {
      const enabled = override && override.enabled !== undefined ? override.enabled : on;
      // ⚠️ PATCH /api/repos/:id 的入参走 repo.update 的 zod 契约，键名是 kebab
      // （`get-loop` / `get-loop-minutes`，与生成客户端 client.generated.ts 同款）。
      // camelCase 的 getLoop 不在契约里，zod 会**静默剥掉**——#145 起弹窗一直这么发，
      // 于是「保存成功」但落库纹丝不动（#182 探针抓个正着）。
      await updateRepo(repo.id, {
        'get-loop': enabled ? 'on' : 'off',
        ...(enabled ? { 'get-loop-minutes': minutesOf(minutes) } : {}),
      });
      const mm = minutesOf(minutes);
      toast(
        enabled
          ? `已保存「${repo.name}」的持续 get 设置（${mm > 0 ? `${mm} 分钟阻塞窗口` : '不阻塞，没活立即返回'}）`
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
                <input
                  className="rp-gl-min"
                  value={minutes}
                  onChange={(e) => setMinutes(e.target.value)}
                  inputMode="numeric"
                  title="0 = 不阻塞：没任务时 get 立即返回 timeout"
                />
                分钟
              </span>
            </div>
            <div className="rp-gl-note">
              {'这里只决定没有任务时 get 最多阻塞多久（0 = 不阻塞，立即返回 timeout）。领到任务后那段「继续 get 直到 timeout」的提示词是全局的，只有一份：要改文案去 设置 → 提示词模板 → 持续 get。'}
            </div>
            <div className="rp-gl-acts">
              <span className="spacer" />
              <Button variant="primary" disabled={busy} onClick={() => save()}>保存持续 get 设置</Button>
            </div>
          </div>
        )}
      </div>
    </Modal>
  );
}
