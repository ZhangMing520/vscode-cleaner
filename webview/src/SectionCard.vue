<script setup lang="ts">
import { computed, h, inject, ref, watch } from 'vue';
import type { Ref } from 'vue';
import { NDataTable } from 'naive-ui';
import type { DataTableColumns } from 'naive-ui';
import { S, Sopt, locale } from './i18n';
import { fmtDate } from './format';
import { formatBytes } from '../../src/format';
import { typeLabel, type RowVM, type SortState } from './rows';

const props = defineProps<{
  secKey: string;
  /** 本分区命中搜索的行，已由父级按当前排序排好（页面展示顺序） */
  rows: RowVM[];
  /** 本分区排序状态（父级持有，Naive 仅按此显示箭头） */
  sort: SortState;
  /** 生效的展开状态（用户折叠意图与搜索强制展开已在父级合并） */
  expanded: boolean;
  /**
   * 勾选集合（非响应式，父级唯一存储）。行渲染读它决定 checkbox 是否勾选，
   * 但因不订阅，勾选变化不会令 DataTable 重渲染；变更后由本组件 watcher 自对账。
   */
  checked: Set<number>;
  /** 分区计数（不随搜索变化） */
  countLeft: number;
  /** 分区总大小（不随搜索变化） */
  totalBytes: number;
}>();

const emit = defineEmits<{
  (e: 'toggle', secKey: string): void;
  (e: 'rowcheck', idx: number, checked: boolean): void;
  (e: 'sectioncheck', secKey: string, checked: boolean): void;
  (e: 'rowclick', row: RowVM, shift: boolean): void;
  (e: 'sortchange', secKey: string, columnKey: string): void;
  (e: 'copy', path: string): void;
}>();

const rootRef = ref<HTMLElement | null>(null);

/** 父级勾选修订号：勾选写入后自增。通过 inject 而非 prop 获取，避免勾选变化
 *  引发本组件重渲染；仅用于触发本组件更新后的自对账。 */
const rev = inject<Ref<number>>('cleanerCheckRev')!;

/**
 * 表格最大高度（px），按整行折算而非拍像素：小尺寸行高约 28px + 表头约 34px，
 * 370px 对应可视约 12 行，超出部分在表内滚动；小表不足 12 行时维持原高度。
 */
const TABLE_MAX_HEIGHT = 370;

/** 分区提示文案；ipch 的 {size} 占位符经 i18n 通用替换为当前分区总大小。 */
const tipText = computed(() =>
  Sopt('tip.' + props.secKey, { size: formatBytes(props.totalBytes) })
);

/**
 * 点击整行。两个豁免避免双重触发：
 * - 行首原生 checkbox：该点击已由其 onChange 处理，冒泡到行不能再切换；
 * - 路径单元格：那里的事件语义是复制完整路径。
 * 勾选决策（普通切换 / Shift 范围选择）统一在父级处理，锚点状态也由父级维护。
 */
function onRowClick(e: MouseEvent, row: RowVM): void {
  const target = e.target as HTMLElement | null;
  if (target?.closest('.row-check, .path-cell')) return;
  emit('rowclick', row, e.shiftKey);
}

function rowProps(row: RowVM): Record<string, unknown> {
  return { style: 'cursor: pointer', onClick: (e: MouseEvent) => onRowClick(e, row) };
}

function onSorter(opt: { columnKey?: string | number; order?: 'ascend' | 'descend' | false }): void {
  const key = opt.columnKey === undefined || opt.columnKey === null ? '' : String(opt.columnKey);
  if (!key) return;
  // 完全受控：排序结果由父级计算（sortRows），此处只上报意图；
  // 切换语义（升/降、换列默认方向）在父级统一实现，不采纳 Naive 的三态循环。
  // 带上 secKey，使父模板无需内联箭头（保持事件 prop 引用稳定）。
  emit('sortchange', props.secKey, key);
}

/** 稳定的行 key 取值器，避免内联箭头每次渲染新建引用而触发 Naive 更新。 */
function getRowKey(r: RowVM): number {
  return r.idx;
}

const columns = computed<DataTableColumns<RowVM>>(() => {
  const orderFor = (key: string) => (props.sort.key === key ? props.sort.order : false);
  // sorter: true = 外部排序声明：Naive 不自行排序，数据的展示顺序即 rows 顺序，
  // 与父级 Shift 范围选择所用顺序严格一致
  return [
    {
      key: '__sel__',
      width: 42,
      align: 'center',
      // 表头：本分区全选。checked 读 headState（非响应式集合，不触发重渲染），
      // 半选态 indeterminate 由更新后的自对账写入。
      title: () =>
        h('input', {
          type: 'checkbox',
          class: 'section-check',
          checked: headState().checked,
          onChange: (e: Event) =>
            emit('sectioncheck', props.secKey, (e.target as HTMLInputElement).checked),
        }),
      // 行首原生 checkbox：点击由浏览器即时翻转（O(1)），onChange 仅把结果上报父级。
      // checked 读取非响应式集合，不触发 DataTable 重渲染；滚动后新挂载的行
      // 会在此读到当前勾选态。
      render: (r) =>
        h('input', {
          type: 'checkbox',
          class: 'row-check',
          'data-idx': String(r.idx),
          checked: props.checked.has(r.idx),
          onChange: (e: Event) =>
            emit('rowcheck', r.idx, (e.target as HTMLInputElement).checked),
        }),
    },
    {
      key: 'name',
      title: S('col.name'),
      width: 250,
      resizable: true,
      ellipsis: { tooltip: true },
      sorter: true,
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
      sorter: true,
      sortOrder: orderFor('type'),
      render: (r) => h('span', typeLabel(r.item.kind)),
    },
    {
      key: 'size',
      title: S('col.size'),
      width: 78,
      resizable: true,
      sorter: true,
      sortOrder: orderFor('size'),
      render: (r) => h('span', formatBytes(r.item.sizeBytes)),
    },
    {
      key: 'path',
      title: S('col.path'),
      width: 520,
      resizable: true,
      sorter: true,
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
      sorter: true,
      sortOrder: orderFor('modified'),
      render: (r) => h('span', fmtDate(r.item.mtime, locale.value)),
    },
  ];
});

/**
 * 表头本分区全选框的状态：命中行全部勾选 → checked；部分勾选 → 半选。
 * 表头 title 渲染与自对账共用同一推导，避免两处规则漂移。
 */
function headState(): { checked: boolean; indeterminate: boolean } {
  let n = 0;
  for (const r of props.rows) if (props.checked.has(r.idx)) n++;
  return {
    checked: props.rows.length > 0 && n === props.rows.length,
    indeterminate: n > 0 && n < props.rows.length,
  };
}

/**
 * 按勾选集校正当前虚拟窗口内的行勾选框及表头全选框。
 * 触发时机（watcher, flush:'post'）：行集合变化（搜索/排序/删除）或勾选修订号
 * 变化后、本组件自身 DOM 更新完成时——此时统计的总是最新行集合，时序自包含。
 */
function reconcile(): void {
  rootRef.value?.querySelectorAll<HTMLInputElement>('input.row-check').forEach((inp) => {
    const want = props.checked.has(Number(inp.dataset.idx));
    if (inp.checked !== want) inp.checked = want;
  });
  const head = rootRef.value?.querySelector<HTMLInputElement>('input.section-check');
  if (head) {
    const st = headState();
    if (head.checked !== st.checked) head.checked = st.checked;
    if (head.indeterminate !== st.indeterminate) head.indeterminate = st.indeterminate;
  }
}

// rows 身份变化或勾选修订号变化，均在本组件更新后对账
watch([() => props.rows, rev], reconcile, { flush: 'post' });
</script>

<template>
  <div ref="rootRef" class="section">
    <h2 class="section-title" @click="emit('toggle', secKey)">
      <span class="toggle">{{ expanded ? '▾' : '▸' }}</span>
      <span>{{ S('section.' + secKey) }}</span>
      <span class="count">({{ countLeft }} · {{ formatBytes(props.totalBytes) }})</span>
    </h2>
    <!-- v-show 而非 v-if：大分区折叠/展开只切换 display，避免销毁重建整表 -->
    <div v-show="expanded" class="section-body">
      <p class="desc">{{ Sopt('desc.' + secKey) }}</p>
      <p v-if="tipText" class="tip">{{ tipText }}</p>
      <!-- 虚拟滚动：只渲染可视区行，排序/搜索/删除及表格内存与总行数无关；
           max-height 让小表维持原样，仅大表在内部滚动 -->
      <n-data-table
        size="small"
        :columns="columns"
        :data="rows"
        :row-key="getRowKey"
        :pagination="false"
        :bordered="false"
        :single-line="true"
        :row-props="rowProps"
        virtual-scroll
        :max-height="TABLE_MAX_HEIGHT"
        @update:sorter="onSorter"
      />
    </div>
  </div>
</template>
