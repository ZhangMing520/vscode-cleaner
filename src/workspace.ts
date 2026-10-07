import * as fs from 'fs/promises';
import * as vscode from 'vscode';
import * as path from 'path';
import { calcDirSize, dirMtime, listFiles, listSubdirs, measureDir, samePath } from './fs';
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
 * 扫描单个 workspaceStorage 根，仅列出「孤儿」工作区缓存。
 * 每个子目录含 workspace.json（folder/workspace 指向原项目路径）。
 * 当该路径在磁盘上已不存在时，视为孤儿缓存——其原项目已删除，仅剩 VS Code 状态，可清理。
 * 远程工作区（remoteAuthority）或无法判定者保守保留，绝不删项目文件夹本身。
 */
async function scanStorageRoot(storageRoot: string): Promise<CleanupItem[]> {
  const items: CleanupItem[] = [];

  for (const name of await listSubdirs(storageRoot)) {
    const dirPath = path.join(storageRoot, name);

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

  return items;
}

/**
 * 扫描 workspaceStorage 孤儿缓存，同时覆盖默认 profile 与全部命名 profile：
 * 默认布局 User/workspaceStorage；命名 profile 布局 User/profiles/<name>/workspaceStorage。
 */
export async function scanWorkspaceStorage(userDataRoot: string): Promise<ScanResult> {
  const storageRoots = [path.join(userDataRoot, 'User', 'workspaceStorage')];
  const profiles = await listSubdirs(path.join(userDataRoot, 'User', 'profiles'));
  for (const profile of profiles) {
    storageRoots.push(path.join(userDataRoot, 'User', 'profiles', profile, 'workspaceStorage'));
  }

  const items = (await Promise.all(storageRoots.map(scanStorageRoot))).flat();
  const totalBytes = items.reduce((sum, it) => sum + it.sizeBytes, 0);
  return { items, totalBytes };
}

/**
 * 扫描用户数据根下的 CachedData（VS Code 自身的 V8/Electron 代码缓存，
 * 非按扩展划分、无法对应到具体扩展）。
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

/**
 * 扫描用户数据根下的 CachedExtensionVSIXs：扩展更新时下载的 .vsix 安装包，
 * 安装完成后即无用武之地，VS Code 永不自动清理。逐条列出每个安装包（文件名即扩展标识），
 * 让用户可单独删除某个扩展的缓存包；整体可安全删除（重装扩展时重新下载）。
 */
export async function scanCachedExtensionVsixs(userDataRoot: string): Promise<ScanResult> {
  const root = path.join(userDataRoot, 'CachedExtensionVSIXs');
  const items: CleanupItem[] = [];
  const now = Date.now();
  for (const name of await listFiles(root)) {
    // 跳过 .<uuid> 形式的下载临时文件
    if (name.startsWith('.')) continue;
    const full = path.join(root, name);
    let stat;
    try {
      stat = await fs.stat(full);
    } catch {
      continue; // 竞态删除
    }
    // 跳过 15 分钟内仍在写入的包（可能正在下载/安装）
    if (!stat.isFile() || now - stat.mtimeMs < 15 * 60 * 1000) continue;
    items.push({ path: full, sizeBytes: stat.size, kind: 'cachedVsixs', label: name, mtime: stat.mtimeMs });
  }

  const totalBytes = items.reduce((sum, it) => sum + it.sizeBytes, 0);
  return { items, totalBytes };
}

/**
 * 扫描用户数据根下的 Cache：Chromium 的 HTTP 磁盘缓存（市场资源、图标、webview 网络资源等）。
 * 按子项（Cache_Data、No_Vary_Search 等）逐条列出：当前运行实例仍持有部分打开文件，
 * 整体删除是 all-or-nothing，拆开后被锁子项单独失败、其余照常清理。
 * 注意：trash 只是移动条目，正被进程持有的数据要等 VS Code 重启并清空回收站才真正释放空间。
 */
export async function scanCodeCache(userDataRoot: string): Promise<ScanResult> {
  const root = path.join(userDataRoot, 'Cache');
  const items: CleanupItem[] = [];

  for (const name of await listSubdirs(root)) {
    const full = path.join(root, name);
    const sizeBytes = await calcDirSize(full);
    const mtime = await dirMtime(full);
    items.push({ path: full, sizeBytes, kind: 'codeCache', label: 'Cache/' + name, mtime });
  }
  for (const name of await listFiles(root)) {
    const full = path.join(root, name);
    let stat;
    try {
      stat = await fs.stat(full);
    } catch {
      continue; // 竞态删除
    }
    if (!stat.isFile()) continue;
    items.push({ path: full, sizeBytes: stat.size, kind: 'codeCache', label: 'Cache/' + name, mtime: stat.mtimeMs });
  }

  const totalBytes = items.reduce((sum, it) => sum + it.sizeBytes, 0);
  return { items, totalBytes };
}

/**
 * 扫描用户数据根下的 logs：每次启动生成一个带时间戳的会话日志目录，只增不减、无限累积。
 * 逐条列出历史会话目录（mtime 取目录内文件的最新修改时间——目录自身 mtime 不随日志追加更新，
 * 会把仍在写入的会话显示成"很旧"），并跳过当前运行实例自己的会话目录（正被打开、删了也不释放空间）。
 */
export async function scanLogs(userDataRoot: string, activeSessionDir?: string): Promise<ScanResult> {
  const root = path.join(userDataRoot, 'logs');
  const items: CleanupItem[] = [];

  const names = await listSubdirs(root);
  for (const name of names) {
    const full = path.join(root, name);
    if (activeSessionDir && samePath(full, activeSessionDir)) continue;
    const measured = await measureDir(full);
    items.push({ path: full, sizeBytes: measured.sizeBytes, kind: 'logs', label: name, mtime: measured.mtimeMs });
  }

  const totalBytes = items.reduce((sum, it) => sum + it.sizeBytes, 0);
  return { items, totalBytes };
}
