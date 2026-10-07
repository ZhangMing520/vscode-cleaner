import * as fs from 'fs/promises';
import * as vscode from 'vscode';
import * as path from 'path';
import { calcDirSize, dirMtime, listSubdirs } from './fs';
import { CleanupItem } from './types';
import { ScanResult } from './ipch';

/** 判断某路径是否仍存在（孤儿缓存判定用）。 */
async function projectExists(p: string): Promise<boolean> {
  try {
    await fs.stat(p);
    return true;
  } catch {
    return false;
  }
}

/**
 * 扫描 User/workspaceStorage，仅列出「孤儿」工作区缓存。
 * 每个子目录含 workspace.json（folder/workspace 指向原项目路径）。
 * 当该路径在磁盘上已不存在时，视为孤儿缓存——其原项目已删除，仅剩 VS Code 状态，可清理。
 * 远程工作区（remoteAuthority）或无法判定者保守保留，绝不删项目文件夹本身。
 */
export async function scanWorkspaceStorage(userDataRoot: string): Promise<ScanResult> {
  const root = path.join(userDataRoot, 'User', 'workspaceStorage');
  const items: CleanupItem[] = [];

  const names = await listSubdirs(root);
  for (const name of names) {
    const dirPath = path.join(root, name);

    let orphan = false;
    let label = name;

    try {
      const raw = JSON.parse(
        await fs.readFile(path.join(dirPath, 'workspace.json'), 'utf8')
      ) as { folder?: string; workspace?: string; remoteAuthority?: string };

      if (raw.remoteAuthority) {
        orphan = false; // 远程工作区无法本地校验，保守保留
      } else {
        const ref = raw.folder ?? raw.workspace;
        if (ref) {
          const target = vscode.Uri.parse(ref).fsPath;
          if (target) {
            orphan = !(await projectExists(target));
            if (orphan) label = target; // 展示已消失的原路径，便于辨认
          }
        }
      }
    } catch {
      // 无 workspace.json（旧格式/损坏）：无法判定归属，保守保留
      orphan = false;
    }

    if (!orphan) continue;

    const sizeBytes = await calcDirSize(dirPath);
    const mtime = await dirMtime(dirPath);
    items.push({ path: dirPath, sizeBytes, kind: 'workspaceStorage', label, mtime });
  }

  const totalBytes = items.reduce((sum, it) => sum + it.sizeBytes, 0);
  return { items, totalBytes };
}

/**
 * 扫描用户数据根下的 CachedData（扩展编译/语法 token 缓存）。
 * 全部可安全删除——VS Code 会在需要时自动重建；仅重建期间首次加载略慢。
 */
export async function scanCachedData(userDataRoot: string): Promise<ScanResult> {
  const root = path.join(userDataRoot, 'CachedData');
  const items: CleanupItem[] = [];

  const names = await listSubdirs(root);
  for (const name of names) {
    const full = path.join(root, name);
    const sizeBytes = await calcDirSize(full);
    const mtime = await dirMtime(full);
    items.push({ path: full, sizeBytes, kind: 'cachedData', label: name, mtime });
  }

  const totalBytes = items.reduce((sum, it) => sum + it.sizeBytes, 0);
  return { items, totalBytes };
}
