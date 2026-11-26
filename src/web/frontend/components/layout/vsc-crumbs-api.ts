// 面包屑的目录列举 API 收口（#276）：只经 /api/repos/dirs（后端有「只许列已登记
// 仓库下子目录」的守卫），组件不直接拼路径。
import { api } from '../../api/client.js';

/** 后端返回的子目录条目。 */
export interface DirEntry {
  name: string;
  path: string;
}

/** 列某目录下的子目录；后端拒绝时（error 字段）抛错给调用方提示。 */
export async function listDirs(path: string): Promise<DirEntry[]> {
  const r = await api(`/api/repos/dirs?path=${encodeURIComponent(path)}`);
  if (r && r.error) throw new Error(String(r.error));
  return r && Array.isArray(r.dirs) ? (r.dirs as DirEntry[]) : [];
}
