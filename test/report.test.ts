import { describe, expect, it, vi } from 'vitest';

vi.mock('vscode', () => ({
  env: { language: 'en', clipboard: { writeText: vi.fn() } },
  window: {
    showInformationMessage: vi.fn(),
    showWarningMessage: vi.fn(),
    createWebviewPanel: vi.fn(),
    createOutputChannel: vi.fn(),
  },
  Uri: { file: (p: string) => ({ fsPath: p }) },
  workspace: { fs: { delete: vi.fn() }, getConfiguration: vi.fn(() => ({ get: () => 0 })) },
  ViewColumn: { One: 1 },
}));

import { renderHtml } from '../src/report';
import { getAllBundles, defaultLocale } from '../src/i18n';
import { CleanupItem } from '../src/types';

const ITEMS: CleanupItem[] = [
  { path: '/root/ipch/ABC', sizeBytes: 10, kind: 'ipch', label: 'ABC', mtime: 1700000000000 },
  { path: '/root/CachedExtensionVSIXs/ms-a.b-1.0.0.vsix', sizeBytes: 50, kind: 'cachedVsixs', label: 'ms-a.b-1.0.0.vsix', mtime: 1700000000000 },
  { path: '/root/logs/20200101T000000', sizeBytes: 70, kind: 'logs', label: '20200101T000000', mtime: 1700000000000 },
];

const CSP = 'vscode-webview://csp';
const ASSETS = { scriptUri: 'vscode-webview://csp/media/main.js', styleUri: 'vscode-webview://csp/media/main.css' };

const html = renderHtml(ITEMS, 'deadbeefcafe0000', CSP, getAllBundles(), defaultLocale(), ASSETS);

function inlineScriptSrc(): string {
  const m = html.match(/<script nonce="[a-f0-9]+">([\s\S]*?)<\/script>/);
  expect(m, 'bootstrap inline <script> not found').not.toBeNull();
  return (m as RegExpMatchArray)[1];
}

describe('renderHtml 宿主 HTML 产出', () => {
  it('CSP：script-src 保持 nonce+cspSource 严格策略，无 unsafe-inline', () => {
    const csp = html.match(/content="([^"]*)"/)![1];
    expect(csp).toContain(`script-src ${CSP} 'nonce-deadbeefcafe0000'`);
    expect(csp).not.toMatch(/script-src[^;]*unsafe-inline/);
  });

  // Naive UI 的 css-render 在运行时动态插入 <style>，无法预加 nonce，style-src 必须放行 unsafe-inline
  it('CSP：style-src 含 unsafe-inline（Naive UI css-render 运行时注入所需）', () => {
    const csp = html.match(/content="([^"]*)"/)![1];
    expect(csp).toMatch(/style-src[^;]*unsafe-inline/);
  });

  it('UI 行为不再内联：bootstrap 内联脚本只注入数据，逻辑全部在打包产物中', () => {
    const script = inlineScriptSrc();
    expect(script).toContain('window.__CLEANER__');
    expect(script).not.toContain('addEventListener');
    expect(script).not.toContain('acquireVsCodeApi');
    expect(html).toContain('<script type="module" src="' + ASSETS.scriptUri + '"></script>');
    expect(html).toContain('<link rel="stylesheet" href="' + ASSETS.styleUri + '">');
  });

  it('bootstrap 注入数据：< 转义防注入，items/langs/locale 三件套齐全', () => {
    const script = inlineScriptSrc();
    // 转义后的路径不含裸 <（防 </script> 逃逸）
    expect(script).not.toMatch(/<(?!\\u003c)/);
    expect(script).toContain('"kind":"ipch"');
    expect(script).toContain('"kind":"cachedVsixs"');
    expect(script).toContain('"kind":"logs"');
    expect(script).toContain('"locale":"en"');
    expect(script).toContain('"section.cachedVsixs"');
  });
});
