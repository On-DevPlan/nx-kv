// 分区成员选择弹窗（#178）：在分区里**直接添加**仓库/分组——用户要的正向入口
// （此前只能从行菜单「移入分区」或把行拖进分区，分区里没有任何添加按钮）。
//
// 候选 = 所有仓库/看板行（未在本分区的排前；已在其它分区的标注出来，加入时会自动挪走）。
import { useState } from 'react';
import { Modal } from '../popup/index.jsx';
import { Button } from '../button/index.js';

export interface NsCandidate {
  /** 条目键（'board:<id>' | '<仓库key>'） */
  key: string;
  label: string;
  kind: 'repo' | 'board';
  /** 已在哪个分区（空 = 未分组） */
  inNsName?: string;
}

export interface NsAddModalProps {
  nsName: string;
  candidates: NsCandidate[];
  onClose: () => void;
  onAdd: (keys: string[]) => void;
}

export default function NsAddModal({ nsName, candidates, onClose, onAdd }: NsAddModalProps) {
  const [picked, setPicked] = useState<Set<string>>(() => new Set());
  const toggle = (k: string) =>
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(k)) next.delete(k);
      else next.add(k);
      return next;
    });
  return (
    <Modal title={`向分区「${nsName}」添加仓库 / 分组`} onClose={onClose}>
      <div className="ns-add-list">
        {candidates.length ? (
          candidates.map((c) => (
            <label key={c.key} className="ns-add-row">
              <input type="checkbox" checked={picked.has(c.key)} onChange={() => toggle(c.key)} />
              <span className={'ns-add-kind ' + c.kind}>{c.kind === 'board' ? '分组' : '仓库'}</span>
              <span className="ns-add-name">{c.label}</span>
              {c.inNsName ? <span className="ns-add-where">现属「{c.inNsName}」</span> : null}
            </label>
          ))
        ) : (
          <div className="setp-note">没有可添加的条目——先去「＋」登记仓库或新建分组。</div>
        )}
      </div>
      <div className="form-acts">
        <Button variant="secondary" onClick={onClose}>取消</Button>
        <Button
          disabled={!picked.size}
          onClick={() => {
            onAdd([...picked]);
            onClose();
          }}
        >
          添加 {picked.size || ''} 项
        </Button>
      </div>
    </Modal>
  );
}
