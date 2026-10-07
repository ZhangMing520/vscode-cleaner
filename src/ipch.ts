import * as path from 'path';
import { calcDirSize, dirMtime, listSubdirs } from './fs';
import { CleanupItem } from './types';

export interface ScanResult {
  items: CleanupItem[];
  totalBytes: number;
}

/**
 * 扫描 vscode-cpptools 的 ipch 缓存目录。
 * ipch 下每个子目录对应一个「工作区 + 配置」的哈希缓存，可整体删除。
 * 目录不存在或无权限时返回空结果，不抛错。
 */
export async function scanIpchCache(ipchRoot: string): Promise<ScanResult> {
  const items: CleanupItem[] = [];

  const names = await listSubdirs(ipchRoot);
  for (const name of names) {
    const full = path.join(ipchRoot, name);
    const sizeBytes = await calcDirSize(full);
    const mtime = await dirMtime(full);
    items.push({ path: full, sizeBytes, kind: 'ipch', label: name, mtime });
  }

  const totalBytes = items.reduce((sum, it) => sum + it.sizeBytes, 0);
  return { items, totalBytes };
}
