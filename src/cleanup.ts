import * as vscode from 'vscode';
import { CleanupItem } from './types';

export interface DeleteResult {
  deleted: number;
  freedBytes: number;
  errors: Array<{ path: string; message: string }>;
}

/**
 * 将清理项移至系统回收站（trash），绝不永久删除。
 * 环境不支持 trash 时，对应项会进入 errors 由调用方提示，且不会回退为强制永久删除。
 */
export async function deleteItems(items: CleanupItem[]): Promise<DeleteResult> {
  const result: DeleteResult = { deleted: 0, freedBytes: 0, errors: [] };

  for (const item of items) {
    try {
      await vscode.workspace.fs.delete(vscode.Uri.file(item.path), {
        recursive: true,
        useTrash: true,
      });
      result.deleted += 1;
      result.freedBytes += item.sizeBytes;
    } catch (e) {
      result.errors.push({
        path: item.path,
        message: e instanceof Error ? e.message : String(e),
      });
    }
  }

  return result;
}
