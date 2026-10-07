import type { CleanupItem } from '../../src/types';
import { S } from './i18n';

/**
 * 表格行视图模型。item 在宿主 items 数组中的原始下标 idx 即与宿主约定的删除索引。
 * lcLabel/lcPath 为搜索/排序预计算的小写键：列表静态，构建一次即可。
 */
export interface RowVM {
  item: CleanupItem;
  idx: number;
  lcLabel: string;
  lcPath: string;
}

/** 搜索谓词的唯一实现：q 已 trim + 小写；空串匹配全部。 */
export function rowMatches(r: RowVM, q: string): boolean {
  return !q || r.lcLabel.includes(q) || r.lcPath.includes(q);
}

export function toRowVM(item: CleanupItem, idx: number): RowVM {
  return {
    item,
    idx,
    lcLabel: item.label.toLowerCase(),
    lcPath: item.path.toLowerCase(),
  };
}

export interface SortState {
  key: string;
  order: 'ascend' | 'descend';
}

export const DEFAULT_SORT: SortState = { key: 'size', order: 'descend' };

/** 数值列的取值器 */
const NUMERIC_KEY: Record<string, (r: RowVM) => number> = {
  size: (r) => r.item.sizeBytes,
  modified: (r) => r.item.mtime,
};

/** type 列文案：kind → 本地化标签，缺失回退 kind。列渲染与排序共用同一规则。 */
export function typeLabel(kind: string): string {
  return S('type.' + kind) || kind;
}

/**
 * 表格行序的唯一实现。表格列用 sorter: true 由外部排序（Naive 不再自排），
 * 渲染顺序与 Shift 范围选择都必须基于本函数的结果，否则两者错位。
 * 就地排序并返回同一数组：唯一调用方传入的是每次新建、无其他引用的 visible 数组。
 */
export function sortRows(rows: RowVM[], sort: SortState): RowVM[] {
  const dir = sort.order === 'ascend' ? 1 : -1;
  const numKey = NUMERIC_KEY[sort.key];
  if (numKey) {
    return rows.sort((a, b) => dir * (numKey(a) - numKey(b)));
  }
  // 文本列：预计算比较键，避免 localeCompare 的每次比较都重新取值
  const textKey = textKeyFor(sort.key);
  const keys = new Map<RowVM, string>();
  for (const r of rows) keys.set(r, textKey(r));
  return rows.sort((a, b) => dir * keys.get(a)!.localeCompare(keys.get(b)!));
}

function textKeyFor(key: string): (r: RowVM) => string {
  if (key === 'name') return (r) => r.lcLabel;
  if (key === 'path') return (r) => r.lcPath;
  // type 列文案随语言变化，小写后比较
  return (r) => typeLabel(r.item.kind).toLowerCase();
}

