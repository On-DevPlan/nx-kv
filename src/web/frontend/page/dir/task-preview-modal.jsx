// 预览弹层（任务 #65）：「agent 执行 get 会收到的提示词」。
//
// 只展示服务端渲染好的原文（data.rendered）+ 段落来源，**不在前端二次拼装**——
// 前端一拼就会与真实交付漂移，而预览的全部价值就是「所见即所得」。
import { useToast } from '../../components/toast/index.jsx';
import { Modal } from '../../components/popup/index.jsx';

export function PreviewModal({ state, onClose }) {
  const toast = useToast();
  const data = state?.data;
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(String(data?.rendered || ''));
      toast('已复制原文');
    } catch {
      toast('复制失败（剪贴板不可用）');
    }
  };
  const sw = data?.switches || {};
  const swLine = data
    ? [
        `ack ${sw.ack?.on ? `开（${sw.ack.count} 条）` : '关'}`,
        `交付上下文 ${sw.deliveryTemplate?.custom ? '自定义' : '内置默认'}`,
        `持续 get ${data.getLoop?.enabled ? `开（${data.getLoop.waitMinutes} 分钟）` : '关'}`,
      ].join(' · ')
    : '';
  const title = data
    ? `预览：agent 执行 get 会收到的提示词${data.task?.id ? ` · #${data.task.id}` : ' · 草稿'}`
    : '预览：agent 执行 get 会收到的提示词';
  return (
    <Modal
      title={title}
      size='wide'
      onClose={onClose}
      footer={
        <>
          <span className='mdw-prev-hint'>与 CLI 取任务共用同一份排版；不含「已取得下一条任务…」头部行。</span>
          <span className='grow' />
          <button type='button' className='btn ghost sm' onClick={copy} disabled={!data}>复制原文</button>
          <button type='button' className='btn sm' onClick={onClose}>关闭</button>
        </>
      }
    >
      {state.busy && <div className='mdw-prev-note'>渲染中…</div>}
      {state.error && (
        <div className='mdw-prev-note'>
          预览失败：{state.error}
          {/* 「接口不存在」= 正在跑的 serve 进程比页面资产旧（路由启动时加载、
              资产现读磁盘，#65 验收反馈实锤过这个 404）——引导重启，别让它
              看起来像瞬时故障。与 overview 批量删除 / use-templates 同一处理。 */}
          {/接口不存在/.test(String(state.error)) && (
            <div className='mdw-prev-hint'>
              本机面板服务较旧：重启面板（结束当前 serve 进程后重新启动）即可生效，刷新页面不够。
            </div>
          )}
        </div>
      )}
      {data && (
        <>
          <pre className='mdw-prev-body'>{data.rendered || ''}</pre>
          {data.segments?.length ? (
            <details className='mdw-prev-seg'>
              <summary>段落来源（{data.segments.length} 段）</summary>
              <ol>
                {data.segments.map((s, i) => (
                  <li key={i}>
                    <span className='mdw-prev-seg-lab'>{s.label}</span>
                    <span className='mdw-prev-seg-n'>{String(s.text || '').length} 字</span>
                  </li>
                ))}
              </ol>
              <div className='mdw-prev-note'>改这些段去「设置 → 提示词 / 模板」；「持续 get」在项目级设置里。</div>
            </details>
          ) : (
            <div className='mdw-prev-note'>当前没有任何模板段：交付时就只有任务正文。</div>
          )}
          <div className='mdw-prev-switch'>{swLine}</div>
        </>
      )}
    </Modal>
  );
}
