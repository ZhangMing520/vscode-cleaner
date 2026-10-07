import * as vscode from 'vscode';
import { resolveRoots } from './paths';
import { scanIpchCache } from './ipch';
import { identifyOldExtensions } from './extensions';
import { scanWorkspaceStorage, scanCachedData } from './workspace';
import { showReport } from './report';
import { t, tWith } from './i18n';
import { formatBytes } from './format';
import { CleanupItem } from './types';

async function collectItems(): Promise<CleanupItem[]> {
  const roots = resolveRoots();
  const ipch = await scanIpchCache(roots.ipchCache);
  const ext = await identifyOldExtensions(roots.extensionsRoot, roots.userDataRoot);
  const ws = await scanWorkspaceStorage(roots.userDataRoot);
  const cached = await scanCachedData(roots.userDataRoot);
  return [...ipch.items, ...ext.items, ...ws.items, ...cached.items];
}

export function activate(context: vscode.ExtensionContext): void {
  const disposable = vscode.commands.registerCommand(
    'vscode-cleaner.scanAndClean',
    async () => {
      const items = await collectItems();
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

      showReport(items);
    }
  );

  context.subscriptions.push(disposable);
}

export function deactivate(): void {
  // 暂无需要清理的资源
}
