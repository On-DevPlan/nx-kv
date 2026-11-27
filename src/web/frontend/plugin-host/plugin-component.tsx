// 插件组件挂载点：找不到组件时给出明确提示，而不是静默空白。
import { usePluginComponent } from './registry.js';

export function PluginComponent({
  pluginId,
  componentId,
  props,
}: {
  pluginId: string;
  componentId?: string;
  props?: Record<string, unknown>;
}) {
  const Component = usePluginComponent(pluginId, componentId);
  if (!Component) {
    return (
      <div className="muted" style={{ padding: 16 }}>
        插件 UI 未注册：{pluginId}/{componentId || '（空）'}。确认插件包已 build，并刷新页面。
      </div>
    );
  }
  return <Component {...(props || {})} />;
}
