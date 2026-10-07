import * as fs from 'fs/promises';
import * as path from 'path';
import { calcDirSize, dirMtime, listSubdirs } from './fs';
import { CleanupItem } from './types';

// 扩展目录名格式：<publisher>.<name>-<version>，如 ms-vscode.powershell-2025.2.0
const FOLDER_RE = /^(.+)-(\d+\.\d+\.\d(?:[-+][0-9A-Za-z.\-]+)?)$/;

export interface ExtensionVersion {
  version: string;
  dirPath: string;
  active: boolean;
}

export interface ExtensionGroup {
  id: string;
  versions: ExtensionVersion[];
}

export interface ExtensionScanResult {
  groups: ExtensionGroup[];
  items: CleanupItem[];
  totalBytes: number;
}

function parseGlobalExtensions(raw: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  if (Array.isArray(raw)) {
    for (const item of raw as Array<Record<string, unknown>>) {
      const id = (item?.identifier as { id?: string } | undefined)?.id ?? (item?.id as string | undefined);
      const version = item?.version as string | undefined;
      if (typeof id === 'string' && typeof version === 'string') {
        out[id] = version;
      }
    }
  }
  return out;
}

function parseProfileExtensions(raw: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  const obj = (raw as { extensions?: unknown } | undefined)?.extensions ?? raw;
  if (obj && typeof obj === 'object' && !Array.isArray(obj)) {
    for (const [k, v] of Object.entries(obj)) {
      if (typeof v === 'string') {
        out[k] = v;
      } else if (v && typeof v === 'object' && typeof (v as { version?: string }).version === 'string') {
        out[k] = (v as { version: string }).version;
      }
    }
  }
  return out;
}

async function readJson(file: string): Promise<unknown | null> {
  try {
    return JSON.parse(await fs.readFile(file, 'utf8'));
  } catch {
    return null;
  }
}

/** 收集默认 profile 与各命名 profile 中仍被启用的 扩展id -> 版本集合 */
async function loadActiveVersions(
  extensionsRoot: string,
  userDataRoot: string
): Promise<Map<string, Set<string>>> {
  const active = new Map<string, Set<string>>();
  const add = (map: Record<string, string>) => {
    for (const [id, version] of Object.entries(map)) {
      if (!active.has(id)) active.set(id, new Set());
      active.get(id)!.add(version);
    }
  };

  // 默认 profile：extensions 目录下的 extensions.json
  const globalJson = await readJson(path.join(extensionsRoot, 'extensions.json'));
  if (globalJson) add(parseGlobalExtensions(globalJson));

  // 各命名 profile
  const profilesDir = path.join(userDataRoot, 'User', 'profiles');
  let profileDirs: string[] = [];
  try {
    const ents = await fs.readdir(profilesDir, { withFileTypes: true });
    profileDirs = ents.filter((e) => e.isDirectory()).map((e) => e.name);
  } catch {
    profileDirs = [];
  }
  for (const p of profileDirs) {
    const pj = await readJson(path.join(profilesDir, p, 'extensions.json'));
    if (pj) add(parseProfileExtensions(pj));
  }

  return active;
}

/**
 * 识别可清理的旧版扩展目录。
 * 规则（保守）：仅当能确认某扩展的激活版本时，才将其余版本标记为可清理；
 * 无法确认激活版本（元数据缺失/不可读）时整组保留，避免误删在用版本。
 */
export async function identifyOldExtensions(
  extensionsRoot: string,
  userDataRoot: string
): Promise<ExtensionScanResult> {
  const active = await loadActiveVersions(extensionsRoot, userDataRoot);

  const dirNames = await listSubdirs(extensionsRoot);
  if (dirNames.length === 0) {
    return { groups: [], items: [], totalBytes: 0 };
  }

  const groupsMap = new Map<string, ExtensionGroup>();
  for (const name of dirNames) {
    const m = FOLDER_RE.exec(name);
    if (!m) continue; // 跳过 .obsolete、extensions.json 等非版本目录
    const id = m[1];
    const version = m[2];
    const dirPath = path.join(extensionsRoot, name);
    const known = active.has(id);
    const isActive = known && (active.get(id) as Set<string>).has(version);
    if (!groupsMap.has(id)) groupsMap.set(id, { id, versions: [] });
    groupsMap.get(id)!.versions.push({ version, dirPath, active: isActive });
  }

  const groups = [...groupsMap.values()];
  const items: CleanupItem[] = [];
  let totalBytes = 0;

  for (const g of groups) {
    if (g.versions.length < 2) continue; // 仅单版本无需清理
    const known = active.has(g.id);
    for (const v of g.versions) {
      if (!known) continue; // 无法确定激活版本，保守保留
      if (v.active) continue; // 保护激活版本
      const sizeBytes = await calcDirSize(v.dirPath);
      const mtime = await dirMtime(v.dirPath);
      items.push({ path: v.dirPath, sizeBytes, kind: 'extension', label: `${g.id}@${v.version}`, mtime });
      totalBytes += sizeBytes;
    }
  }

  return { groups, items, totalBytes };
}
