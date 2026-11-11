// 对齐 remote 弹窗：key 是本地身份，remote 是协作的标准单位——两者要对齐，
// 但对齐方向由人定（自动的 SSH 优先只是默认值）。数据面来自 git remote -v。
// 这里给出「列候选 / 人工换一条 / 查存在性」。
import { useCallback, useEffect, useState } from 'react';
import { api } from '../../api/client.js';
import { useGuard, useToast } from '../../components/toast/index.jsx';
import { Modal } from '../../components/popup/index.jsx';
import { Button } from '../../components/button/index.jsx';
import type { RepoRecord } from './repo-table.js';

/** 一条 git remote 候选（数据面来自 git remote -v）。 */
interface RemoteItem {
  name: string;
  url: string;
  kind?: string;
  current?: boolean;
}

/** /api/repos/remote/list 的出站形状。 */
interface RemoteInfo {
  key: string;
  name: string;
  current?: string;
  remotes: RemoteItem[];
}

/** 存在性检查的本地状态（checking 是提交中的临时态）。 */
interface CheckState {
  url: string;
  status: string;
  detail?: string;
}

export default function RemoteModal({ repo, onClose, onSaved }: {
  repo: RepoRecord;
  onClose: () => void;
  onSaved: () => void | Promise<void>;
}) {
  const guard = useGuard();
  const toast = useToast();
  const [info, setInfo] = useState<RemoteInfo | null>(null); // { key, name, current, remotes:[…] }
  const [check, setCheck] = useState<CheckState | null>(null); // { url, status, detail }

  // 候选加载失败 = 打不开弹窗（与旧行为一致：只 toast，不出现空弹窗）
  const load = useCallback(async () => {
    try {
      const d = await api<RemoteInfo>('/api/repos/remote/list?id=' + encodeURIComponent(repo.key));
      if (!d || !Array.isArray(d.remotes)) throw new Error('远程地址读取失败');
      setInfo(d);
    } catch (e) {
      toast(String((e as Error).message || e));
      onClose();
    }
  }, [repo.key, toast, onClose]);
  useEffect(() => { load(); }, [load]);

  const pick = (url: string) => guard(async () => {
    // info 为空时弹窗根本不会渲染（见下方 if (!info) return null），这里只是收窄
    if (!info) return;
    await api('/api/repos/remote/pick', {
      method: 'POST',
      body: { id: info.key, url },
    });
    onClose();
    toast('已对齐 remote');
    await onSaved();
  });

  // 存在性检查：git ls-remote 要几秒，期间不给任何反馈会像「点了没反应」。
  // 错误直接写进弹窗（check.detail），不靠 toast —— toast 会一闪而过。
  const checkOne = async (url: string) => {
    const key = info ? info.key : '';
    if (!key) {
      setCheck({ url: '', status: 'unreachable', detail: '没有仓库标识' });
      return;
    }
    setCheck({ url: url || info?.current || '', status: 'checking', detail: '检查中…' });
    try {
      const d = await api<CheckState>('/api/repos/remote/check?id=' + encodeURIComponent(key)
        + (url ? '&url=' + encodeURIComponent(url) : ''));
      setCheck(d);
    } catch (e) {
      setCheck({
        url: url || info?.current || '',
        status: 'unreachable',
        detail: String((e as Error).message || e),
      });
    }
  };

  if (!info) return null;

  return (
    <Modal title={`对齐 remote · ${info.name}`} onClose={onClose}>
      <div className="form-grid" data-testid="rp-remote-modal">
        <div className="form-field">
          <div className="form-hint">
            当前采纳：<b>{info.current || '（无）'}</b>。换一条即对齐（key 随之重算；自定义 key 不动）。
          </div>
          <div className="rp-remote-list">
            {info.remotes.map((rm) => (
              <div className="rp-remote-item" key={rm.name + '|' + rm.url}>
                <span className="rp-remote-name">{rm.name}</span>
                <span className="mono rp-remote-url">{rm.url}</span>
                <span className="rp-remote-kind">{rm.kind}</span>
                {rm.current ? <span className="rp-remote-on">当前</span> : null}
                <span className="acts">
                  {!rm.current ? (
                    <Button small onClick={() => pick(rm.url)}>对齐这条</Button>
                  ) : null}
                  <Button small onClick={() => checkOne(rm.url)}>检查</Button>
                </span>
              </div>
            ))}
            {!info.remotes.length ? (
              <div className="muted">这个仓库没有配置 remote —— 先在 git 里 git remote add</div>
            ) : null}
          </div>
        </div>
        {check ? (
          <div className="form-field">
            <label>存在性检查</label>
            <div className="rp-remote-check">
              <span className={'rp-status ' + (check.status === 'exists' ? 'same' : check.status === 'missing' ? 'new' : check.status === 'checking' ? 'checking' : 'missing')}>
                {check.status === 'exists' ? '存在'
                  : check.status === 'missing' ? '不存在'
                  : check.status === 'checking' ? '检查中'
                  : '不可达'}
              </span>
              <span className="mono rp-remote-url">{check.url}</span>
              <span className="muted">{check.detail}</span>
            </div>
          </div>
        ) : null}
        <div className="form-acts">
          <Button  onClick={onClose}>关闭</Button>
          <Button  onClick={() => checkOne('')}>检查当前 remote</Button>
        </div>
      </div>
    </Modal>
  );
}
