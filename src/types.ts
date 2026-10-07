export type CleanupKind = 'ipch' | 'extension' | 'workspaceStorage' | 'cachedData' | 'cachedVsixs' | 'codeCache' | 'logs';

export interface CleanupItem {
  /** 绝对路径 */
  path: string;
  /** 占用字节数 */
  sizeBytes: number;
  /** 类型，用于 UI 分组与确认文案 */
  kind: CleanupKind;
  /** 展示名（如哈希目录名、扩展 id+版本） */
  label: string;
  /** 目录最后修改时间（毫秒时间戳），用于报告中的「修改时间」列 */
  mtime: number;
}
