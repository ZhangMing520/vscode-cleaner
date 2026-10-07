import type { CleanupItem } from '../../src/types';

/**
 * 表格行视图模型。item 在宿主 items 数组中的原始下标 idx 即与宿主约定的删除索引。
 * lcLabel/lcPath 为搜索/排序预计算的小写键：列表静态，构建一次即可。
 */
export interface RowVM {
  item: CleanupItem;
  idx: number;
  deleted: boolean;
  lcLabel: string;
  lcPath: string;
}

/** 搜索谓词的唯一实现：q 已 trim + 小写；空串匹配全部。 */
export function rowMatches(r: RowVM, q: string): boolean {
  return !q || r.lcLabel.includes(q) || r.lcPath.includes(q);
}

export function toRowVM(item: CleanupItem, idx: number, deleted: boolean): RowVM {
  return {
    item,
    idx,
    deleted,
    lcLabel: item.label.toLowerCase(),
    lcPath: item.path.toLowerCase(),
  };
}
