import { describe, expect, it, afterEach, vi } from 'vitest';
import * as path from 'path';

// resolveRoots 读 process.platform / process.env / os.homedir()，三者均可在此安全打桩；
// vitest 每文件独立模块图，不影响其它测试文件。
let mockHome = '/home/u';
vi.mock('os', async (importOriginal) => {
  const actual = await importOriginal<typeof import('os')>();
  return { ...actual, homedir: () => mockHome, default: { ...(actual as object), homedir: () => mockHome } };
});

function setPlatform(p: NodeJS.Platform) {
  Object.defineProperty(process, 'platform', { value: p, configurable: true });
}

function setEnv(env: Record<string, string | undefined>) {
  for (const [k, v] of Object.entries(env)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
}

const PREV_PLATFORM = process.platform;
const ENV_KEYS = ['APPDATA', 'LOCALAPPDATA', 'XDG_CONFIG_HOME', 'XDG_CACHE_HOME'];
const PREV_ENV = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));

afterEach(() => {
  setPlatform(PREV_PLATFORM);
  setEnv(PREV_ENV);
  vi.resetModules();
});

describe('resolveRoots 平台路径解析', () => {
  it('Linux：未设 XDG 变量时回退 ~/.config 与 ~/.cache', async () => {
    setPlatform('linux');
    mockHome = '/home/u';
    setEnv({ XDG_CONFIG_HOME: undefined, XDG_CACHE_HOME: undefined });
    const { resolveRoots } = await import('../src/paths');
    const r = resolveRoots();
    expect(r.extensionsRoot).toBe('/home/u/.vscode/extensions');
    expect(r.userDataRoot).toBe('/home/u/.config/Code');
    expect(r.ipchCache).toBe('/home/u/.cache/vscode-cpptools/ipch');
  });

  it('Linux：设置 XDG 变量时优先使用', async () => {
    setPlatform('linux');
    mockHome = '/home/u';
    setEnv({ XDG_CONFIG_HOME: '/xdg/conf', XDG_CACHE_HOME: '/xdg/cache' });
    const { resolveRoots } = await import('../src/paths');
    const r = resolveRoots();
    expect(r.userDataRoot).toBe('/xdg/conf/Code');
    expect(r.ipchCache).toBe('/xdg/cache/vscode-cpptools/ipch');
  });

  it('Windows：使用 APPDATA / LOCALAPPDATA，扩展根仍在用户目录下', async () => {
    setPlatform('win32');
    mockHome = 'C:\\Users\\u';
    setEnv({ APPDATA: 'C:\\Users\\u\\AppData\\Roaming', LOCALAPPDATA: 'C:\\Users\\u\\AppData\\Local' });
    const { resolveRoots } = await import('../src/paths');
    const r = resolveRoots();
    expect(r.extensionsRoot).toContain('.vscode');
    // 测试进程的 path 分隔符随宿主平台（CI 为 posix），期望值用 path.join 构造，
    // 验证点是「APPDATA/LOCALAPPDATA 被采用」而非分隔符本身。
    expect(r.userDataRoot).toBe(path.join('C:\\Users\\u\\AppData\\Roaming', 'Code'));
    expect(r.ipchCache).toBe(path.join('C:\\Users\\u\\AppData\\Local', 'Microsoft', 'vscode-cpptools', 'ipch'));
  });

  it('Windows：缺 APPDATA/LOCALAPPDATA 时回退默认布局', async () => {
    setPlatform('win32');
    mockHome = 'C:\\Users\\u';
    setEnv({ APPDATA: undefined, LOCALAPPDATA: undefined });
    const { resolveRoots } = await import('../src/paths');
    const r = resolveRoots();
    expect(r.userDataRoot).toBe(path.join('C:\\Users\\u', 'AppData', 'Roaming', 'Code'));
    expect(r.ipchCache).toBe(path.join('C:\\Users\\u', 'AppData', 'Local', 'Microsoft', 'vscode-cpptools', 'ipch'));
  });

  it('macOS：Library 布局', async () => {
    setPlatform('darwin');
    mockHome = '/Users/u';
    const { resolveRoots } = await import('../src/paths');
    const r = resolveRoots();
    expect(r.userDataRoot).toBe('/Users/u/Library/Application Support/Code');
    expect(r.ipchCache).toBe('/Users/u/Library/Caches/vscode-cpptools/ipch');
  });

  it('三平台的扩展根均为 ~/.vscode/extensions', async () => {
    for (const p of ['linux', 'win32', 'darwin'] as NodeJS.Platform[]) {
      setPlatform(p);
      mockHome = '/home/u';
      const { resolveRoots } = await import('../src/paths');
      const r = resolveRoots();
      expect(r.extensionsRoot.endsWith('.vscode/extensions') || r.extensionsRoot.endsWith('.vscode\\extensions')).toBe(true);
    }
  });
});
