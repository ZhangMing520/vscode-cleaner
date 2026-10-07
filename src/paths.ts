import * as os from 'os';
import * as path from 'path';

export interface ResolvedRoots {
  /** 用户扩展根：~/.vscode/extensions */
  extensionsRoot: string;
  /** 用户数据根：含 User/、CachedData、Cache 等 */
  userDataRoot: string;
  /** C/C++ IntelliSense 缓存（ipch）目录 */
  ipchCache: string;
}

/**
 * 按平台解析 VS Code 的两个独立数据根与 ipch 缓存路径。
 * 均不硬编码绝对路径，且兼容 XDG / LOCALAPPDATA / APPDATA 等环境变量。
 */
export function resolveRoots(): ResolvedRoots {
  const home = os.homedir();

  // 扩展根在所有平台均为 ~/.vscode/extensions
  const extensionsRoot = path.join(home, '.vscode', 'extensions');

  let userDataRoot: string;
  let ipchCache: string;

  switch (process.platform) {
    case 'win32':
      userDataRoot = path.join(
        process.env.APPDATA ?? path.join(home, 'AppData', 'Roaming'),
        'Code'
      );
      ipchCache = path.join(
        process.env.LOCALAPPDATA ?? path.join(home, 'AppData', 'Local'),
        'Microsoft',
        'vscode-cpptools',
        'ipch'
      );
      break;
    case 'darwin':
      userDataRoot = path.join(home, 'Library', 'Application Support', 'Code');
      ipchCache = path.join(home, 'Library', 'Caches', 'vscode-cpptools', 'ipch');
      break;
    default: // linux 及其他类 unix
      userDataRoot = path.join(
        process.env.XDG_CONFIG_HOME ?? path.join(home, '.config'),
        'Code'
      );
      ipchCache = path.join(
        process.env.XDG_CACHE_HOME ?? path.join(home, '.cache'),
        'vscode-cpptools',
        'ipch'
      );
      break;
  }

  return { extensionsRoot, userDataRoot, ipchCache };
}
