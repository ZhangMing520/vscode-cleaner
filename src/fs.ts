import * as fs from 'fs/promises';
import * as path from 'path';

/**
 * 路径等价比较：Windows 不区分大小写（URI.fsPath 盘符常为小写，与 env 派生路径可能不一致）；
 * 其余平台按原样比较。
 */
export function samePath(a: string, b: string): boolean {
  return process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b;
}

/**
 * 递归计算目录占用字节数（与 measureDir 共用同一遍历策略）。
 */
export async function calcDirSize(dir: string): Promise<number> {
  return (await measureDir(dir)).sizeBytes;
}

/**
 * 获取目录自身的最后修改时间（毫秒时间戳）。
 * 读取失败时返回 0，不影响扫描主流程。
 */
export async function dirMtime(dir: string): Promise<number> {
  try {
    return (await fs.stat(dir)).mtimeMs;
  } catch {
    return 0;
  }
}

/**
 * 列出目录下的子目录名；目录不存在或无权限时返回空数组，不抛错。
 * 供各扫描器复用，避免重复 readdir + try/catch + isDirectory 样板。
 */
export async function listSubdirs(dir: string): Promise<string[]> {
  let entries;
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  return entries.filter((e) => e.isDirectory()).map((e) => e.name);
}

/**
 * 列出目录下的文件名（不含子目录）；目录不存在或无权限时返回空数组，不抛错。
 * 供扫描器复用，避免重复 readdir + try/catch 样板。
 */
export async function listFiles(dir: string): Promise<string[]> {
  let entries;
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  return entries.filter((e) => e.isFile()).map((e) => e.name);
}

/**
 * 单次递归遍历同时得到目录总字节数与"最近活动时间"（目录及内部所有文件 mtime 的最大值）。
 * 目录自身 mtime 不随内部文件追加而更新，需要真实最近时间时必须递归取最大值。
 * 跳过符号链接避免环；任何读取失败按 0/忽略处理，不抛错。
 */
export async function measureDir(dir: string): Promise<{ sizeBytes: number; mtimeMs: number }> {
  let mtimeMs;
  try {
    mtimeMs = (await fs.stat(dir)).mtimeMs;
  } catch {
    return { sizeBytes: 0, mtimeMs: 0 };
  }
  let sizeBytes = 0;
  let entries;
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return { sizeBytes, mtimeMs };
  }
  for (const entry of entries) {
    if (entry.isSymbolicLink()) continue;
    const full = path.join(dir, entry.name);
    try {
      if (entry.isDirectory()) {
        const sub = await measureDir(full);
        sizeBytes += sub.sizeBytes;
        mtimeMs = Math.max(mtimeMs, sub.mtimeMs);
      } else {
        const stat = await fs.stat(full);
        sizeBytes += stat.size;
        mtimeMs = Math.max(mtimeMs, stat.mtimeMs);
      }
    } catch {
      // 权限不足或竞态删除，忽略该项
    }
  }
  return { sizeBytes, mtimeMs };
}
