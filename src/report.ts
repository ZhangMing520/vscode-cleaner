import * as vscode from 'vscode';
import * as fs from 'fs';
import * as crypto from 'crypto';
import * as path from 'path';
import { CleanupItem, CleanerBootstrap, HostToWebviewMessage, WebviewToHostMessage } from './types';
import { deleteItems } from './cleanup';
import { formatBytes } from './format';
import { t, tWith, getAllBundles, defaultLocale } from './i18n';

/** webview 前端产物（由 `npm run webview:build` 从 webview/ 打包到 media/）。 */
export interface WebviewAssets {
  scriptUri: string;
  styleUri: string;
}

/** 打开 Webview 报告页：分区表格 + 排序 + 搜索 + 语言切换 + 页内确认 + 回收站删除。 */
export function showReport(items: CleanupItem[], extensionUri: vscode.Uri): void {
  const panel = vscode.window.createWebviewPanel(
    'vscodeCleanerReport',
    t('report.title'),
    vscode.ViewColumn.One,
    { enableScripts: true, retainContextWhenHidden: true }
  );

  const scriptOnDisk = path.join(extensionUri.fsPath, 'media', 'main.js');
  const styleOnDisk = path.join(extensionUri.fsPath, 'media', 'main.css');
  if (!fs.existsSync(scriptOnDisk) || !fs.existsSync(styleOnDisk)) {
    panel.webview.html =
      '<!DOCTYPE html><html><head><meta charset="UTF-8"></head>' +
      '<body style="font-family:var(--vscode-font-family,sans-serif);padding:20px">' +
      t('report.bundleMissing') + '</body></html>';
    return;
  }

  const webview = panel.webview;
  const assets: WebviewAssets = {
    scriptUri: webview.asWebviewUri(vscode.Uri.file(scriptOnDisk)).toString(),
    styleUri: webview
      .asWebviewUri(vscode.Uri.file(path.join(extensionUri.fsPath, 'media', 'main.css')))
      .toString(),
  };

  const nonce = crypto.randomBytes(16).toString('hex');
  webview.html = renderHtml(items, nonce, webview.cspSource, getAllBundles(), defaultLocale(), assets);

  webview.onDidReceiveMessage(async (msg: WebviewToHostMessage) => {
    if (msg.command === 'copy') {
      const text = typeof msg.text === 'string' && items.some((it) => it.path === msg.text) ? msg.text : undefined;
      if (!text) return;
      try {
        await vscode.env.clipboard.writeText(text);
        vscode.window.showInformationMessage(tWith(msg.locale || defaultLocale(), 'report.copiedPath'));
      } catch {
        // 剪贴板写入失败（如显示环境限制），静默返回而非未处理拒绝
      }
      return;
    }
    if (msg.command !== 'delete' || !msg.indices || msg.indices.length === 0) {
      return;
    }
    const indices = msg.indices;

    const chosen = indices.map((i) => items[i]).filter(Boolean);
    const channel = vscode.window.createOutputChannel('VS Code Cleaner');
    channel.appendLine(`Deleting ${chosen.length} items...`);

    const result = await deleteItems(chosen);
    for (const err of result.errors) {
      channel.appendLine(`  FAILED ${err.path}: ${err.message}`);
    }
    channel.appendLine(`  done: deleted ${result.deleted}, freed ${result.freedBytes}`);

    const failedPaths = new Set(result.errors.map((e) => e.path));
    const deletedIndices: number[] = [];
    chosen.forEach((c, k) => {
      if (!failedPaths.has(c.path)) deletedIndices.push(indices[k]);
    });

    const resultMsg: HostToWebviewMessage = {
      command: 'result',
      deletedIndices: deletedIndices,
      deleted: result.deleted,
      freedBytes: result.freedBytes,
      errorCount: result.errors.length,
    };
    webview.postMessage(resultMsg);

    if (result.errors.length === 0) {
      vscode.window.showInformationMessage(
        tWith(msg.locale || defaultLocale(), 'ext.cleaned', { n: result.deleted, size: formatBytes(result.freedBytes) })
      );
    } else {
      vscode.window.showWarningMessage(
        tWith(msg.locale || defaultLocale(), 'ext.failed', { n: result.deleted, m: result.errors.length })
      );
    }
  });
}

/**
 * 生成 webview 的宿主 HTML：只负责 CSP、bootstrap 数据注入与产物引用；
 * 全部 UI 行为在 webview/ 下的 Vue 应用中（tsc/vite 可编译检查，不再有模板字符串内嵌脚本）。
 *
 * CSP 注意点：Naive UI 走 css-render 在运行时动态插入 <style>，无法预先加 nonce，
 * 因此 style-src 必须放行 'unsafe-inline'；script-src 保持 nonce + cspSource 严格策略。
 */
export function renderHtml(
  items: CleanupItem[],
  nonce: string,
  cspSource: string,
  LANGS: Record<string, Record<string, string>>,
  defaultLocale: string,
  assets: WebviewAssets
): string {
  const bootstrap: CleanerBootstrap = { items, langs: LANGS, locale: defaultLocale };
  const bootstrapJson = JSON.stringify(bootstrap).replace(/</g, '\\u003c');

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy"
  content="default-src 'none'; img-src ${cspSource} https:; script-src ${cspSource} 'nonce-${nonce}'; style-src ${cspSource} 'unsafe-inline';">
<link rel="stylesheet" href="${assets.styleUri}">
</head>
<body>
  <div id="app"></div>
<script nonce="${nonce}">
  window.__CLEANER__ = ${bootstrapJson};
</script>
<script type="module" src="${assets.scriptUri}"></script>
</body>
</html>`;
}
