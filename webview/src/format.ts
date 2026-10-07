/** 修改时间列：按当前 UI 语言选 toLocaleString 的 locale。 */
export function fmtDate(ms: number, locale: string): string {
  if (!ms) return '—';
  const loc = locale === 'zh-cn' ? 'zh-CN' : 'en-US';
  return new Date(ms).toLocaleString(loc, {
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
  });
}
