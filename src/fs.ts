import * as fs from 'fs/promises';
import * as path from 'path';

/**
 * 递归计算目录占用字节数。
 * 跳过符号链接以避免环；单个条目读取失败时忽略，继续累加其余。
 */
export async function calcDirSize(dir: string): Promise<number> {
  let entries;
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return 0;
  }

  let total = 0;
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isSymbolicLink()) {
      continue;
    }
    try {
      if (entry.isDirectory()) {
        total += await calcDirSize(full);
      } else if (entry.isFile()) {
        total += (await fs.stat(full)).size;
      }
    } catch {
      // 权限不足或竞态删除，忽略该项
    }
  }
  return total;
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
