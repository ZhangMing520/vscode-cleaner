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

/**
 * webview → 宿主 消息。两侧必须共用此联合类型：
 * 任何一侧私自改字段名都会在这里编译失败，而不是运行时静默失联。
 */
export type WebviewToHostMessage =
  | { command: 'copy'; text: string; locale?: string }
  | { command: 'delete'; indices: number[]; locale?: string };

/** 宿主 → webview 消息：删除结果（仅回传成功删除的下标）。 */
export interface HostToWebviewMessage {
  command: 'result';
  deletedIndices: number[];
  deleted: number;
  freedBytes: number;
  errorCount: number;
}

/** 宿主通过带 nonce 的内联 bootstrap 脚本注入 webview 的数据。 */
export interface CleanerBootstrap {
  items: CleanupItem[];
  langs: Record<string, Record<string, string>>;
  locale: string;
}
