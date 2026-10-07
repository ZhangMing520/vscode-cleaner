const UNITS = ['B', 'KB', 'MB', 'GB', 'TB'];

/** 将字节数格式化为可读字符串，如 `4.20 GB`。 */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  let value = bytes / 1024;
  let i = 1;
  while (value >= 1024 && i < UNITS.length - 1) {
    value /= 1024;
    i++;
  }
  return `${value.toFixed(2)} ${UNITS[i]}`;
}
