import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { listSubdirs, calcDirSize, measureDir } from '../src/fs';
import { scanIpchCache } from '../src/ipch';
import { identifyOldExtensions } from '../src/extensions';
import { scanWorkspaceStorage, scanCachedExtensionVsixs, scanCodeCache, scanLogs } from '../src/workspace';

// vscode 仅在扩展宿主可用；单测里 mock 出 Uri.parse 供 scanWorkspaceStorage 用
vi.mock('vscode', () => ({
  Uri: {
    parse: (s: string) => ({ fsPath: s.startsWith('file://') ? s.slice('file://'.length) : s }),
  },
}));

let tmp: string;

async function mkdirp(p: string): Promise<void> {
  await fs.mkdir(p, { recursive: true });
}
async function writeFile(p: string, content = 'x'): Promise<void> {
  await fs.writeFile(p, content);
}
async function setMtime(p: string, d: Date): Promise<void> {
  await fs.utimes(p, d, d);
}

beforeEach(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'vscode-cleaner-test-'));
});
afterEach(async () => {
  await fs.rm(tmp, { recursive: true, force: true });
});

describe('listSubdirs', () => {
  it('只返回子目录名，忽略文件', async () => {
    await mkdirp(path.join(tmp, 'a'));
    await mkdirp(path.join(tmp, 'b'));
    await writeFile(path.join(tmp, 'file.txt'));
    const names = await listSubdirs(tmp);
    expect(names.sort()).toEqual(['a', 'b']);
  });

  it('目录不存在时返回空数组而非抛错', async () => {
    expect(await listSubdirs(path.join(tmp, 'nope'))).toEqual([]);
  });
});

describe('scanIpchCache', () => {
  it('汇总每个子目录的大小', async () => {
    const root = path.join(tmp, 'ipch');
    await mkdirp(path.join(root, 'h1'));
    await writeFile(path.join(root, 'h1', 'a'), '12345'); // 5 bytes
    await mkdirp(path.join(root, 'h2'));
    await writeFile(path.join(root, 'h2', 'b'), '123'); // 3 bytes

    const res = await scanIpchCache(root);
    expect(res.items).toHaveLength(2);
    expect(res.totalBytes).toBe(8);
    expect(res.items.every((i) => i.kind === 'ipch')).toBe(true);
  });

  it('目录不存在时返回空', async () => {
    const res = await scanIpchCache(path.join(tmp, 'missing'));
    expect(res.items).toHaveLength(0);
    expect(res.totalBytes).toBe(0);
  });
});

describe('identifyOldExtensions', () => {
  it('仅标记非激活的旧版本，保留单版本与激活版本', async () => {
    const extRoot = path.join(tmp, 'extensions');
    await mkdirp(path.join(extRoot, 'ms-a.b-1.0.0'));
    await mkdirp(path.join(extRoot, 'ms-a.b-2.0.0'));
    await mkdirp(path.join(extRoot, 'ms-c.d-1.0.0')); // 仅一个版本，不清理
    await writeFile(
      path.join(extRoot, 'extensions.json'),
      JSON.stringify([{ identifier: { id: 'ms-a.b' }, version: '2.0.0' }])
    );
    const userData = path.join(tmp, 'userdata');
    await mkdirp(path.join(userData, 'User', 'profiles')); // 无 profile，活跃版本仅来自默认

    const res = await identifyOldExtensions(extRoot, userData);
    const labels = res.items.map((i) => i.label).sort();
    expect(labels).toEqual(['ms-a.b@1.0.0']);
  });

  it('无法确认激活版本时保守保留（不标记任何旧版本）', async () => {
    const extRoot = path.join(tmp, 'extensions');
    await mkdirp(path.join(extRoot, 'ms-a.b-1.0.0'));
    await mkdirp(path.join(extRoot, 'ms-a.b-2.0.0'));
    // 注意：故意不写 extensions.json

    const res = await identifyOldExtensions(extRoot, tmp);
    expect(res.items).toHaveLength(0);
  });

  it('多 profile：被其他 profile 使用的版本不可删', async () => {
    const extRoot = path.join(tmp, 'extensions');
    await mkdirp(path.join(extRoot, 'ms-x-1.0.0'));
    await mkdirp(path.join(extRoot, 'ms-x-2.0.0'));
    await writeFile(
      path.join(extRoot, 'extensions.json'),
      JSON.stringify([{ identifier: { id: 'ms-x' }, version: '2.0.0' }])
    );
    const userData = path.join(tmp, 'userdata');
    await mkdirp(path.join(userData, 'User', 'profiles', 'p1'));
    await writeFile(
      path.join(userData, 'User', 'profiles', 'p1', 'extensions.json'),
      JSON.stringify({ extensions: { 'ms-x': '1.0.0' } }) // p1 仍在使用 1.0.0
    );

    const res = await identifyOldExtensions(extRoot, userData);
    expect(res.items).toHaveLength(0); // 1.0.0 被 p1 占用，不得删
  });
});

describe('scanWorkspaceStorage', () => {
  it('只列出原项目已消失的孤儿缓存', async () => {
    const userData = path.join(tmp, 'userdata');
    const wsRoot = path.join(userData, 'User', 'workspaceStorage');
    const alive = path.join(tmp, 'alive-project');
    const gone = path.join(tmp, 'gone-project');
    await mkdirp(alive); // 存在
    // gone 不创建目录，模拟「原项目已消失」

    const h1 = path.join(wsRoot, 'hash1');
    await mkdirp(h1);
    await writeFile(path.join(h1, 'workspace.json'), JSON.stringify({ folder: 'file://' + alive }));

    const h2 = path.join(wsRoot, 'hash2');
    await mkdirp(h2);
    await writeFile(path.join(h2, 'workspace.json'), JSON.stringify({ folder: 'file://' + gone }));

    const res = await scanWorkspaceStorage(userData);
    expect(res.items).toHaveLength(1);
    expect(res.items[0].label).toBe(gone); // 标的是消失的原路径
  });

  it('远程工作区保守保留', async () => {
    const userData = path.join(tmp, 'userdata');
    const wsRoot = path.join(userData, 'User', 'workspaceStorage');
    const h = path.join(wsRoot, 'hash-remote');
    await mkdirp(h);
    await writeFile(path.join(h, 'workspace.json'), JSON.stringify({ remoteAuthority: 'ssh-remote' }));

    const res = await scanWorkspaceStorage(userData);
    expect(res.items).toHaveLength(0);
  });

  it('命名 profile 下的孤儿缓存与默认 profile 一并被扫描', async () => {
    const userData = path.join(tmp, 'userdata');
    const goneDefault = path.join(tmp, 'gone-default');
    const goneProfile = path.join(tmp, 'gone-profile');

    const hDefault = path.join(userData, 'User', 'workspaceStorage', 'hashD');
    await mkdirp(hDefault);
    await writeFile(path.join(hDefault, 'workspace.json'), JSON.stringify({ folder: 'file://' + goneDefault }));

    const hProfile = path.join(userData, 'User', 'profiles', 'Work', 'workspaceStorage', 'hashP');
    await mkdirp(hProfile);
    await writeFile(path.join(hProfile, 'workspace.json'), JSON.stringify({ folder: 'file://' + goneProfile }));

    const res = await scanWorkspaceStorage(userData);
    expect(res.items).toHaveLength(2);
    expect(res.items.map((i) => i.label).sort()).toEqual([goneDefault, goneProfile].sort());
  });
});

describe('calcDirSize', () => {
  it('递归累加文件大小', async () => {
    const d = path.join(tmp, 'dir');
    await mkdirp(path.join(d, 'sub'));
    await writeFile(path.join(d, 'a'), '12345');
    await writeFile(path.join(d, 'sub', 'b'), '678');
    expect(await calcDirSize(d)).toBe(8);
  });
});

describe('measureDir', () => {
  it('单次遍历同时累加大小、取内部文件 mtime 最大值', async () => {
    const d = path.join(tmp, 'sess');
    await mkdirp(path.join(d, 'win'));
    await writeFile(path.join(d, 'main.log'), 'abc');
    await writeFile(path.join(d, 'win', 'exthost.log'), 'de');
    const old = new Date(Date.UTC(2020, 0, 1));
    const late = new Date(Date.UTC(2024, 5, 1));
    await setMtime(d, old);
    await setMtime(path.join(d, 'win'), old);
    await setMtime(path.join(d, 'main.log'), old);
    await setMtime(path.join(d, 'win', 'exthost.log'), late);
    const m = await measureDir(d);
    expect(m.sizeBytes).toBe(5);
    expect(m.mtimeMs).toBe(late.getTime());
  });

  it('目录不存在返回 0/空而非抛错', async () => {
    expect(await measureDir(path.join(tmp, 'nope'))).toEqual({ sizeBytes: 0, mtimeMs: 0 });
  });
});

describe('scanCachedExtensionVsixs', () => {
  it('跳过 . 前缀隐藏临时文件与 15 分钟内的新包', async () => {
    const userData = path.join(tmp, 'userdata');
    const root = path.join(userData, 'CachedExtensionVSIXs');
    await mkdirp(root);
    await writeFile(path.join(root, '.6554c1f8-b6df'), 'hidden');
    await writeFile(path.join(root, 'ms-a.b-1.0.0.vsix'), 'oldpkg');
    await writeFile(path.join(root, 'ms-c.d-2.0.0.vsix'), 'fresh');
    const past = new Date(Date.UTC(2020, 0, 1));
    await setMtime(path.join(root, 'ms-a.b-1.0.0.vsix'), past);
    const res = await scanCachedExtensionVsixs(userData);
    expect(res.items.map((i) => i.label)).toEqual(['ms-a.b-1.0.0.vsix']);
    expect(res.items[0].sizeBytes).toBe(6);
  });

  it('目录不存在时为空', async () => {
    expect(await scanCachedExtensionVsixs(path.join(tmp, 'none'))).toEqual({ items: [], totalBytes: 0 });
  });
});

describe('scanCodeCache', () => {
  it('逐条列出 Cache 的子目录与顶层文件', async () => {
    const userData = path.join(tmp, 'userdata');
    const cache = path.join(userData, 'Cache');
    await mkdirp(path.join(cache, 'Cache_Data'));
    await writeFile(path.join(cache, 'Cache_Data', 'f1'), 'abc');
    await writeFile(path.join(cache, 'No_Vary_Search'), 'de');
    const res = await scanCodeCache(userData);
    expect(res.items.map((i) => i.label).sort()).toEqual(['Cache/Cache_Data', 'Cache/No_Vary_Search']);
    expect(res.totalBytes).toBe(5);
    expect(res.items.every((i) => i.kind === 'codeCache')).toBe(true);
  });

  it('目录不存在时为空', async () => {
    expect(await scanCodeCache(path.join(tmp, 'none'))).toEqual({ items: [], totalBytes: 0 });
  });
});

describe('scanLogs', () => {
  it('跳过活动会话目录，mtime 取会话内最新文件时间', async () => {
    const userData = path.join(tmp, 'userdata');
    const logs = path.join(userData, 'logs');
    const s1 = path.join(logs, '20200101T000000');
    const s2 = path.join(logs, '20240101T000000');
    await mkdirp(path.join(s1, 'win'));
    await writeFile(path.join(s1, 'main.log'), 'x');
    await writeFile(path.join(s1, 'win', 'a.log'), 'yy');
    await mkdirp(s2);
    await writeFile(path.join(s2, 'main.log'), 'z');
    const old = new Date(Date.UTC(2020, 0, 1));
    const late = new Date(Date.UTC(2024, 5, 1));
    await setMtime(s1, old);
    await setMtime(path.join(s1, 'win'), old);
    await setMtime(path.join(s1, 'main.log'), old);
    await setMtime(path.join(s1, 'win', 'a.log'), late);
    const res = await scanLogs(userData, s2);
    expect(res.items.map((i) => i.label)).toEqual(['20200101T000000']);
    expect(res.items[0].sizeBytes).toBe(3);
    expect(res.items[0].mtime).toBe(late.getTime());
  });
});
