<script setup lang="ts">
import { computed, h, ref } from 'vue';
import { NDataTable } from 'naive-ui';
import type { DataTableColumns } from 'naive-ui';
import { S, Sopt, locale } from './i18n';
import { fmtDate } from './format';
import { formatBytes } from '../../src/format';
import type { RowVM } from './rows';

const props = defineProps<{
  secKey: string;
  /** 本分区命中搜索的行（过滤在父级统一做） */
  rows: RowVM[];
  /** 生效的展开状态（用户折叠意图与搜索强制展开已在父级合并） */
  expanded: boolean;
  /** 全局已勾选的 idx 集合 */
  checked: Set<number>;
  /** 分区计数（不随搜索变化） */
  countLeft: number;
  /** 分区总大小（不随搜索变化） */
  totalBytes: number;
}>();

const emit = defineEmits<{
  (e: 'toggle'): void;
  (e: 'check', keys: number[]): void;
  (e: 'copy', path: string): void;
}>();

const sortKey = ref<string>('size');
const sortOrder = ref<'ascend' | 'descend'>('descend');

// 与旧版语义一致：全选只作用于「当前可见」的行；
// 搜索只过滤显示，绝不替用户自动勾选/取消勾选可见行。
const tableKeys = computed(() =>
  props.rows.filter((r) => props.checked.has(r.idx)).map((r) => r.idx)
);

/** 分区提示文案；ipch 的 {size} 占位符经 i18n 通用替换为当前分区总大小。 */
const tipText = computed(() =>
  Sopt('tip.' + props.secKey, { size: formatBytes(props.totalBytes) })
);

function onTableCheck(keys: Array<string | number>): void {
  emit('check', keys.map(Number));
}

/**
 * 点击整行切换勾选。两个豁免避免双重触发：
 * - 勾选列：不豁免整列的话，点击会先被 Naive 切换一次、冒泡到行再切换一次而相互抵消
 *   （checkbox 及其内部 input/label 都在该单元格内，一次 closest 即可覆盖）；
 * - 点击路径单元格：那里的事件语义是复制完整路径。
 */
function onRowClick(e: MouseEvent, row: RowVM): void {
  const target = e.target as HTMLElement | null;
  if (target?.closest('.n-data-table-td--selection, .path-cell')) return;
  const keys = tableKeys.value.includes(row.idx)
    ? tableKeys.value.filter((k) => k !== row.idx)
    : [...tableKeys.value, row.idx];
  emit('check', keys);
}

function rowProps(row: RowVM): Record<string, unknown> {
  return { style: 'cursor: pointer', onClick: (e: MouseEvent) => onRowClick(e, row) };
}

function onSorter(opt: { columnKey?: string | number; order?: 'ascend' | 'descend' | false }): void {
  const key = opt.columnKey === undefined || opt.columnKey === null ? '' : String(opt.columnKey);
  if (!key) return;
  // 完全受控切换，不采纳 Naive 的三态循环（ascend→descend→false）：
  // 旧 UI 语义是同列反复点击在升/降序间无限切换，取消排序不是目标状态。
  if (key === sortKey.value) {
    sortOrder.value = sortOrder.value === 'ascend' ? 'descend' : 'ascend';
  } else {
    sortKey.value = key;
    sortOrder.value = key === 'size' ? 'descend' : 'ascend';
  }
}

const columns = computed<DataTableColumns<RowVM>>(() => {
  const orderFor = (key: string) => (sortKey.value === key ? sortOrder.value : false);
  // 比较键已在行模型预小写（lcLabel/lcPath），比较器不再每次 toLowerCase
  const byText = (get: (r: RowVM) => string) => (a: RowVM, b: RowVM) => get(a).localeCompare(get(b));
  return [
    { type: 'selection' },
    {
      key: 'name',
      title: S('col.name'),
      width: 250,
      resizable: true,
      ellipsis: { tooltip: true },
      sorter: byText((r) => r.lcLabel),
      sortOrder: orderFor('name'),
      // 行对象是 {item, idx, ...}，Naive 无法按 key 直接取值，必须显式 render
      render: (r) => r.item.label,
    },
    {
      key: 'type',
      title: S('col.type'),
      width: 110,
      resizable: true,
      ellipsis: { tooltip: true },
      sorter: byText((r) => (S('type.' + r.item.kind) || r.item.kind).toLowerCase()),
      sortOrder: orderFor('type'),
      render: (r) => h('span', S('type.' + r.item.kind) || r.item.kind),
    },
    {
      key: 'size',
      title: S('col.size'),
      width: 78,
      resizable: true,
      sorter: (a, b) => a.item.sizeBytes - b.item.sizeBytes,
      sortOrder: orderFor('size'),
      render: (r) => h('span', formatBytes(r.item.sizeBytes)),
    },
    {
      key: 'path',
      title: S('col.path'),
      width: 520,
      resizable: true,
      sorter: byText((r) => r.lcPath),
      sortOrder: orderFor('path'),
      render: (r) =>
        h(
          'div',
          {
            class: 'path-cell',
            title: r.item.path + '\n' + S('report.copyPathHint'),
            onClick: () => emit('copy', r.item.path),
          },
          r.item.path
        ),
    },
    {
      key: 'modified',
      title: S('col.modified'),
      width: 132,
      resizable: true,
      sorter: (a, b) => a.item.mtime - b.item.mtime,
      sortOrder: orderFor('modified'),
      render: (r) => h('span', fmtDate(r.item.mtime, locale.value)),
    },
  ];
});
</script>

<template>
  <div class="section">
    <h2 class="section-title" @click="emit('toggle')">
      <span class="toggle">{{ expanded ? '▾' : '▸' }}</span>
      <span>{{ S('section.' + secKey) }}</span>
      <span class="count">({{ countLeft }} · {{ formatBytes(props.totalBytes) }})</span>
    </h2>
    <!-- v-show 而非 v-if：大分区（如 ipch 数百行）折叠/展开只切换 display，
         避免每次点击销毁并重建整表 DOM 造成的卡顿 -->
    <div v-show="expanded" class="section-body">
      <p class="desc">{{ Sopt('desc.' + secKey) }}</p>
      <p v-if="tipText" class="tip">{{ tipText }}</p>
      <n-data-table
        size="small"
        :columns="columns"
        :data="rows"
        :row-key="(r: RowVM) => r.idx"
        :checked-row-keys="tableKeys"
        :pagination="false"
        :bordered="false"
        :single-line="true"
        :row-props="rowProps"
        @update:checked-row-keys="onTableCheck"
        @update:sorter="onSorter"
      />
    </div>
  </div>
</template>
