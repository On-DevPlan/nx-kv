// 云端清单（KV todo）的数据与操作。
//
// 与本机队列是两套独立存储：云端按 groupId 工作空间共享，本机按目录队列。
// 生命周期也不同（云端要拉取、可能未登录、可能不可达），所以单独成 hook，
// 视图文件里只留「本机队列」的编排逻辑。
import { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '../../web/frontend/api/client.js';

/**
 * @param {object} p
 * @param {boolean} p.loggedIn   是否已登录（未登录 → guest 态，云端不可用）
 * @param {string}  p.dirName    当前目录名（云端条目按 topic 匹配）
 * @param {boolean} p.cloudAll   true = 看全部 topic，false = 只看当前目录
 * @param {Function} p.toast     错误提示
 * @param {Function} p.dialog    输入弹窗（新增/完成结果）
 */
export function useCloudDir({ loggedIn, dirName, cloudAll, toast, dialog }) {
  const [cloud, setCloud] = useState({ state: loggedIn ? 'loading' : 'guest', items: null });

  const refetchCloud = useCallback(async () => {
    if (!loggedIn) { setCloud({ state: 'guest', items: null }); return; }
    setCloud((c) => ({ ...c, state: 'loading' }));
    try {
      const d = await api('/api/todo', { method: 'GET' });
      setCloud({ state: 'ok', items: d });
    } catch (e) {
      setCloud({ state: 'err', items: null, err: String(e.message || e) });
    }
  }, [loggedIn]);

  useEffect(() => { refetchCloud(); }, [refetchCloud]);

  const cloudItems = useMemo(() => {
    if (!cloud.items) return null;
    const pick = (arr) => (cloudAll ? arr : arr.filter((t) => t.topic === dirName));
    return {
      open: pick(cloud.items.open || []),
      done: pick(cloud.items.done || []),
      freeze: pick(cloud.items.freeze || []),
    };
  }, [cloud.items, cloudAll, dirName]);

  const cloudGuard = (fn) => fn().catch((e) => { toast('云端操作失败: ' + (e.message || e)); throw e; });

  const cloudAdd = () => cloudGuard(async () => {
    const text = await dialog({ title: `新增云端任务（topic=${dirName}）`, input: true, placeholder: '任务内容' });
    if (!text) return;
    await api('/api/todo', { method: 'POST', body: { topic: dirName, text } });
    refetchCloud();
  });

  const cloudDone = (t) => cloudGuard(async () => {
    const result = await dialog({ title: '完成结果（可选，写入 note）', input: true });
    await api('/api/todo/done', { method: 'POST', body: { ref: t.text, topic: t.topic, pick: undefined, ...(result ? { result } : {}) } });
    refetchCloud();
  });

  const cloudFreeze = (t) => cloudGuard(async () => {
    await api('/api/todo/freeze', { method: 'POST', body: { ref: t.text, topic: t.topic } });
    refetchCloud();
  });

  const cloudUnfreeze = (t) => cloudGuard(async () => {
    await api('/api/todo/unfreeze', { method: 'POST', body: { ref: t.text, topic: t.topic } });
    refetchCloud();
  });

  const cloudRemove = (t) => cloudGuard(async () => {
    await api('/api/todo/item', { method: 'DELETE', body: { ref: t.text, topic: t.topic } });
    refetchCloud();
  });

  return { cloud, refetchCloud, cloudItems, cloudAdd, cloudDone, cloudFreeze, cloudUnfreeze, cloudRemove };
}
