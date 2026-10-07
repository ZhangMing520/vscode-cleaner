import * as vscode from 'vscode';
import * as path from 'path';
import { resolveRoots } from './paths';
import { scanIpchCache } from './ipch';
import { identifyOldExtensions } from './extensions';
import { scanWorkspaceStorage, scanCachedData, scanCachedExtensionVsixs, scanCodeCache, scanLogs } from './workspace';
import { showReport } from './report';
import { t, tWith } from './i18n';
import { formatBytes } from './format';
import { samePath } from './fs';
import { CleanupItem } from './types';

/**
 * 从运行实例自身的 globalStorage 路径反推真实 userDataRoot，
 * 避免 resolveRoots 的硬编码 'Code' 目录名在 Insiders/分支/--user-data-dir 下
 * 指向另一个正在运行的实例。兼容默认与命名 profile 两种布局。
 */
function realUserDataRoot(context: vscode.ExtensionContext): string | undefined {
  // .../globalStorage/<extId> -> profile 根
  let dir = path.dirname(path.dirname(context.globalStorageUri.fsPath));
  if (path.basename(dir) === 'User') return path.dirname(dir);
  // 命名 profile: <userData>/User/profiles/<name>
  const parent = path.dirname(dir);
  if (path.basename(parent) === 'profiles') {
    const user = path.dirname(parent);
    if (path.basename(user) === 'User') return path.dirname(user);
  }
  return undefined;
}

/** 当前运行实例的会话日志目录（logs/<timestamp>）：从 context.logUri 向上遍历定位。 */
function activeLogSessionDir(context: vscode.ExtensionContext, userDataRoot: string): string | undefined {
  const logsRoot = path.join(userDataRoot, 'logs');
  let dir = context.logUri.fsPath;
  for (;;) {
    const parent = path.dirname(dir);
    if (parent === dir) return undefined;
    if (samePath(parent, logsRoot)) return dir;
    dir = parent;
  }
}

async function collectItems(context: vscode.ExtensionContext): Promise<CleanupItem[]> {
  const roots = resolveRoots();
  const userDataRoot = realUserDataRoot(context) ?? roots.userDataRoot;
  const activeSession = activeLogSessionDir(context, userDataRoot);
  // 各扫描器只读、互不依赖且保证不抛错，并行执行把墙钟时间从各扫描器之和降到近似最大值。
  // 旧版扩展的激活判定仍用启发式 roots 配对：派生根与启发式根不一致时，
  // 避免把另一实例 profile 在用的版本标为可删。
  const [ipch, ext, ws, cached, vsixs, codeCache, logs] = await Promise.all([
    scanIpchCache(roots.ipchCache),
    identifyOldExtensions(roots.extensionsRoot, roots.userDataRoot),
    scanWorkspaceStorage(userDataRoot),
    scanCachedData(userDataRoot),
    scanCachedExtensionVsixs(userDataRoot),
    scanCodeCache(userDataRoot),
    scanLogs(userDataRoot, activeSession),
  ]);
  return [...ipch.items, ...ext.items, ...ws.items, ...cached.items, ...vsixs.items, ...codeCache.items, ...logs.items];
}

export function activate(context: vscode.ExtensionContext): void {
  const disposable = vscode.commands.registerCommand(
    'vscode-cleaner.scanAndClean',
    async () => {
      const items = await collectItems(context);
      if (items.length === 0) {
        vscode.window.showInformationMessage(t('ext.noItems'));
        return;
      }

      const minSizeMB = vscode.workspace.getConfiguration('vscode-cleaner').get<number>('minSizeMB') ?? 0;
      const total = items.reduce((s, it) => s + it.sizeBytes, 0);
      if (minSizeMB > 0 && total < minSizeMB * 1024 * 1024) {
        vscode.window.showInformationMessage(
          tWith(vscode.env.language, 'ext.belowThreshold', { size: formatBytes(total), min: minSizeMB })
        );
        return;
      }

      showReport(items, context.extensionUri);
    }
  );

  context.subscriptions.push(disposable);
}

export function deactivate(): void {
  // 暂无需要清理的资源
}
