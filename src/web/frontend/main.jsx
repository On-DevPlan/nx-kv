// 面板入口：Provider 组装（store → toast → dialog → App）。
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.jsx';
import { StoreProvider } from './store.jsx';
import { ToastProvider } from './components/ui.jsx';
import './style.css';
import './modules/md-workspace/style.css'; // MD 工作台面板（page-panel / landing / progress / 模板面板共用）
import './style-v2.css'; // 面板 v2（侧边栏 + 目录工作台）追加样式

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <StoreProvider>
      <ToastProvider>
        <App />
      </ToastProvider>
    </StoreProvider>
  </StrictMode>
);
