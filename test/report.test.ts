import { describe, expect, it, vi } from 'vitest';
import * as vm from 'vm';

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
  { path: '/root/extensions/ms-a.b-1.0.0', sizeBytes: 20, kind: 'extension', label: 'ms-a.b@1.0.0', mtime: 1700000000000 },
  { path: '/root/User/workspaceStorage/hash1', sizeBytes: 30, kind: 'workspaceStorage', label: '/gone/proj', mtime: 1700000000000 },
  { path: '/root/CachedData/abcd', sizeBytes: 40, kind: 'cachedData', label: 'abcd', mtime: 1700000000000 },
  { path: '/root/CachedExtensionVSIXs/ms-a.b-1.0.0.vsix', sizeBytes: 50, kind: 'cachedVsixs', label: 'ms-a.b-1.0.0.vsix', mtime: 1700000000000 },
  { path: '/root/Cache/Cache_Data', sizeBytes: 60, kind: 'codeCache', label: 'Cache/Cache_Data', mtime: 1700000000000 },
  { path: '/root/logs/20200101T000000', sizeBytes: 70, kind: 'logs', label: '20200101T000000', mtime: 1700000000000 },
];

function scriptOf(html: string): string {
  const m = html.match(/<script nonce="[a-f0-9]+">([\s\S]*?)<\/script>/);
  expect(m, 'embedded <script> not found').not.toBeNull();
  return (m as RegExpMatchArray)[1];
}

const script = scriptOf(renderHtml(ITEMS, 'deadbeefcafe0000', 'vscode-webview://csp', getAllBundles(), defaultLocale()));

describe('renderHtml 生成的 webview 脚本', () => {
  // tsc 看不见模板字符串内部 JS 的语法错误，这条是唯一的静态守卫
  it('生成脚本必须可解析（防模板字符串转义破坏整个页面）', () => {
    expect(() => new vm.Script(script)).not.toThrow();
  });

  it('acquireVsCodeApi 在脚本顶部恰好声明一次', () => {
    expect(script.match(/acquireVsCodeApi\(\)/g)).toHaveLength(1);
    expect(script.trimStart().startsWith('const vscode = acquireVsCodeApi();')).toBe(true);
  });

  it('路径单元格 title 唯一来源：applyLocale 中转义换行拼接路径与复制提示', () => {
    expect(script).toMatch(/r\.path \+ '\\n' \+ S\('report\.copyPathHint'\)/);
    // title 只在 applyLocale 一处赋值（初始渲染即调用），不得再有第二处拼接
    expect(script.match(/ \+ S\('report\.copyPathHint'\)/g)).toHaveLength(1);
  });

  it('tip/desc 可选文案走 Sopt（缺失返回空串），不走 S() 的原始 key 回退', () => {
    expect(script).toMatch(/Sopt\('tip\./);
    expect(script).not.toMatch(/S\('tip\.'/);
    expect(script).not.toMatch(/S\('desc\.'/);
  });

  it('搜索不得替用户自动勾选行', () => {
    expect(script).not.toMatch(/r\.cb\.checked = hasQuery/);
  });
});
