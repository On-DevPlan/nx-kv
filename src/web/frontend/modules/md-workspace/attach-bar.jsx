import { Icon } from '../../components/icons.jsx';

/** 附件列表（添加入口在工具区，此处只展示/移除） */
export default function AttachBar({ attachments, onRemove }) {
  if (!attachments?.length) return null;
  return (
    <div className="mdw-attach">
      <div className="lab">附件 / 图片</div>
      <div className="list">
        {attachments.map((a) => (
          <div className="att" key={a.id}>
            {a.type === 'image' && a.url
              ? <img src={a.url} alt="" />
              : <div className="ico"><Icon name="list" size={14} /></div>}
            <div className="meta">
              <div className="n">{a.name}</div>
              <div className="s">{a.size}</div>
            </div>
            <button type="button" className="x" aria-label="移除" onClick={() => onRemove(a.id)}>×</button>
          </div>
        ))}
      </div>
    </div>
  );
}
