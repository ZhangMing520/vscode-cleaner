<script setup lang="ts">
import { computed, onMounted, onUnmounted, provide, ref, watch } from 'vue';
import {
  NButton,
  NCheckbox,
  NConfigProvider,
  NGlobalStyle,
  NInput,
  NModal,
} from 'naive-ui';
import { secondaryButton, theme, themeOverrides } from './theme';
import { S, locale } from './i18n';
import { formatBytes } from '../../src/format';
import { vscode } from './vscode';
import SectionCard from './SectionCard.vue';
import { rowMatches, sortRows, toRowVM, DEFAULT_SORT, type RowVM, type SortState } from './rows';
import type { CleanupItem, HostToWebviewMessage } from '../../src/types';

const CONFIRM_PREVIEW = 8;

const props = defineProps<{ items: CleanupItem[] }>();

const SECTIONS = [
  'ipch',
  'extension',
  'workspaceStorage',
  'cachedData',
  'cachedVsixs',
  'codeCache',
  'logs',
] as const;
type SectionKey = (typeof SECTIONS)[number];

const query = ref('');
const q = computed(() => query.value.trim().toLowerCase());

/** 用户折叠意图：搜索框非空时强制展开，清空后还原。 */
const userCollapsed = ref<Record<string, boolean>>({});
/**
 * 勾选集合：唯一存储，本身非响应式（行渲染直接读它而不订阅，勾选不触发
 * DataTable 重渲染）。修订号 rev 在写入后自增，依赖勾选的 computed 读 rev 后
 * 再读集合；各 SectionCard 通过 inject(rev) 自行对账（发布/订阅，无命令式 fan-out）。
 */
const checked = new Set<number>();
const rev = ref(0);
provide('cleanerCheckRev', rev);
const deleted = ref<Set<number>>(new Set());
const deleting = ref(false);
/** 完成信息结构化存储；文案经 computed 随语言实时切换，避免快照残留旧语言。
 * 删除中状态直接复用 deleting，不再重复建模。 */
const doneInfo = ref<{ freed: number; errors: number } | null>(null);
const confirmOpen = ref(false);

const status = computed(() => {
  if (deleting.value) return S('report.deleting');
  const info = doneInfo.value;
  if (!info) return '';
  return (
    S('report.doneFreed') + ' ' + formatBytes(info.freed) +
    (info.errors ? ', ' + info.errors + ' ' + S('report.andFailed') : '')
  );
});

const rowsBySection = computed<Record<SectionKey, RowVM[]>>(() => {
  const map = Object.fromEntries(SECTIONS.map((k) => [k, [] as RowVM[]])) as Record<SectionKey, RowVM[]>;
  props.items.forEach((item, idx) => {
    // 删除成功即从报告中移除该行（分区计数/总大小随之更新），不以划线形式残留
    if (deleted.value.has(idx)) return;
    map[item.kind as SectionKey]?.push(toRowVM(item, idx));
  });
  return map;
});

interface SectionView {
  key: SectionKey;
  /** 命中搜索且按当前排序排好的行：即页面真实展示顺序 */
  visible: RowVM[];
  /** 分区行数（不随搜索变化） */
  count: number;
  /** 分区总大小（不随搜索变化），兼作排序键 */
  bytes: number;
}

/** 各分区排序状态，唯一来源：表格渲染与 Shift 范围选择都基于它算出的顺序。 */
const sorts = ref<Record<string, SortState>>({});

/** 读取分区排序，缺省回退 DEFAULT_SORT（默认值规则只存在于此）。 */
function sortFor(key: string): SortState {
  return sorts.value[key] ?? DEFAULT_SORT;
}

/**
 * 每分区单次遍历统计（总大小/搜索命中）并排好展示顺序，分区按总大小降序（大分区优先）。
 * 零命中的分区整卡隐藏，避免成排的 "No Data" 空态。
 */
const sectionsView = computed<SectionView[]>(() => {
  const list = SECTIONS.map((key) => {
    const rows = rowsBySection.value[key];
    const visible: RowVM[] = [];
    let bytes = 0;
    for (const r of rows) {
      bytes += r.item.sizeBytes;
      if (rowMatches(r, q.value)) visible.push(r);
    }
    return { key, visible: sortRows(visible, sortFor(key)), count: rows.length, bytes };
  });
  list.sort((a, b) => b.bytes - a.bytes);
  return list;
});

/** 表头点击：同列升/降切换，换列时 size 默认降序、其余升序（旧 UI 语义）。 */
function onSortChange(key: string, columnKey: string): void {
  const prev = sortFor(key);
  let order: SortState['order'];
  if (columnKey === prev.key) {
    order = prev.order === 'ascend' ? 'descend' : 'ascend';
  } else {
    order = columnKey === 'size' ? 'descend' : 'ascend';
  }
  sorts.value = { ...sorts.value, [key]: { key: columnKey, order } };
}

function isExpanded(key: string): boolean {
  return !userCollapsed.value[key] || q.value.length > 0;
}

function toggle(key: string): void {
  userCollapsed.value[key] = !userCollapsed.value[key];
}

/** 已勾选的全部行：计数始终如实反映勾选状态，折叠与搜索不使其"消失"。
 * 误删风险由确认弹窗（预览将删项目与总量）兜底，而非隐藏勾选。 */
const selected = computed<RowVM[]>(() => {
  void rev.value;
  const out: RowVM[] = [];
  for (const key of SECTIONS) {
    for (const r of rowsBySection.value[key]) {
      if (checked.has(r.idx)) out.push(r);
    }
  }
  return out;
});
const selectedTotal = computed(() => selected.value.reduce((s, r) => s + r.item.sizeBytes, 0));
const summary = computed(
  () => `${selected.value.length} ${S('report.itemsWord')} · ${formatBytes(selectedTotal.value)}`
);

// 选择集变化即撤销页内确认（与旧版行为一致：改选后旧确认作废）
watch(selected, () => {
  confirmOpen.value = false;
});

/** 统一写入勾选集；有实际变更才 bump rev（驱动 computed 与卡片自对账）。 */
function applyCheck(indices: Iterable<number>, v: boolean): void {
  let changed = false;
  for (const i of indices) {
    if (v) {
      if (!checked.has(i)) {
        checked.add(i);
        changed = true;
      }
    } else if (checked.has(i)) {
      checked.delete(i);
      changed = true;
    }
  }
  if (changed) rev.value++;
}
function resetCheck(): void {
  if (checked.size) {
    checked.clear();
    rev.value++;
  }
}

/** 行首原生 checkbox 直接点击：浏览器已翻转该框，仅写入集合；表头由卡片自对账校正。 */
function onRowCheck(idx: number, v: boolean): void {
  applyCheck([idx], v);
}

/**
 * 分区表头全选：作用范围为本分区当前命中搜索的行（与旧版 Naive 表头全选一致），
 * 勾选/取消整组。
 */
function onSectionCheck(secKey: string, v: boolean): void {
  const view = sectionsView.value.find((s) => s.key === secKey);
  if (view) applyCheck(view.visible.map((r) => r.idx), v);
}

/** 全局全选的作用范围：无搜索时为全部行，搜索时为全部命中行。 */
const selectableAll = computed<number[]>(() =>
  sectionsView.value.flatMap((s) => s.visible.map((r) => r.idx))
);

/** Shift 范围选择的锚点：最近一次普通点击的行（纯命令式状态，不进模板/computed）。 */
let anchor: number | null = null;

/**
 * 行点击勾选：普通点击切换该行并记录锚点；
 * Shift+点击把锚点到当前行之间（按页面展示顺序，可跨分区）的行全部勾选。
 */
function onRowClick(row: RowVM, shift: boolean): void {
  // 先确定本次要应用的变更：有效 Shift 范围 或 单行切换；随后统一写入
  let range: number[] | null = null;
  if (shift && anchor !== null && anchor !== row.idx) {
    // selectableAll 即页面展示顺序（跨分区），与表格行序同源
    const a = selectableAll.value.indexOf(anchor);
    const b = selectableAll.value.indexOf(row.idx);
    // 锚点行已被搜索/排序移出可见范围（indexOf 为 -1）时，退化为单行切换
    if (a !== -1 && b !== -1) {
      range = selectableAll.value.slice(Math.min(a, b), Math.max(a, b) + 1);
    }
  }
  if (range) {
    applyCheck(range, true);
  } else {
    applyCheck([row.idx], !checked.has(row.idx));
  }
  anchor = row.idx;
}

// 锚点失效规则单一表达：展示顺序变化（排序/搜索/删除）即清空。
// 勾选框对 rows 变化的对账单由各卡片在自身更新后自行完成，此处不再涉及。
// selectableAll 仅依赖 items/deleted/q/sorts，不依赖勾选，普通点击不会触发
watch(selectableAll, () => {
  anchor = null;
});

/** 单趟统计作用域内勾选数，allChecked/someChecked 共用，避免两次展开遍历。 */
const hitState = computed(() => {
  void rev.value;
  let hits = 0;
  for (const i of selectableAll.value) if (checked.has(i)) hits++;
  return { total: selectableAll.value.length, hits };
});
const allChecked = computed(
  () => hitState.value.total > 0 && hitState.value.hits === hitState.value.total
);
const someChecked = computed(() => hitState.value.hits > 0);

function toggleAll(v: boolean): void {
  if (v) {
    applyCheck(selectableAll.value, true);
  } else {
    // 取消全选语义为"清空全部勾选"（含搜索隐藏行的勾选），否则全局框会永远停在半选态
    resetCheck();
  }
}

const confirmPreview = computed(() => {
  const labels = selected.value.slice(0, CONFIRM_PREVIEW).map((r) => r.item.label);
  let preview = labels.join(', ');
  if (selected.value.length > CONFIRM_PREVIEW) {
    preview += ' (' + S('report.confirmMore', { n: selected.value.length - CONFIRM_PREVIEW }) + ')';
  }
  return preview;
});

const confirmText = computed(() => {
  if (selected.value.length === 0) return '';
  return (
    S('report.confirmPrefix') + ' ' + selected.value.length + ' ' + S('report.confirmSuffix') +
    ' (' + formatBytes(selectedTotal.value) + ')? ' + S('report.confirmNote') + ' [' + confirmPreview.value + ']'
  );
});

function onDeleteClick(): void {
  if (deleting.value || selected.value.length === 0) return;
  doneInfo.value = null;
  confirmOpen.value = true;
}

function doDelete(): void {
  confirmOpen.value = false;
  deleting.value = true;
  vscode.postMessage({ command: 'delete', indices: selected.value.map((r) => r.idx), locale: locale.value });
}

function onCopy(path: string): void {
  vscode.postMessage({ command: 'copy', text: path, locale: locale.value });
}

function onHostMessage(e: MessageEvent): void {
  const msg = e.data as { command?: string } & Partial<HostToWebviewMessage>;
  if (msg.command !== 'result') return;
  // 已删行先批量标记移除，再一次性从勾选集剔除（rev 只 bump 一次）；
  // 锚点清理由 watch(selectableAll) 在顺序变化时统一处理
  const deletedIndices = msg.deletedIndices ?? [];
  for (const i of deletedIndices) deleted.value.add(i);
  applyCheck(deletedIndices, false);
  deleting.value = false;
  doneInfo.value = { freed: msg.freedBytes ?? 0, errors: msg.errorCount ?? 0 };
}

onMounted(() => window.addEventListener('message', onHostMessage));
onUnmounted(() => window.removeEventListener('message', onHostMessage));
</script>

<template>
  <n-config-provider :theme="theme" :theme-overrides="themeOverrides">
    <n-global-style />
    <h1 class="page-title">{{ S('report.title') }}</h1>
    <p class="page-sub">{{ S('report.subtitle') }}</p>

    <div class="toolbar">
      <n-checkbox
        class="check-all"
        :checked="allChecked"
        :indeterminate="someChecked && !allChecked"
        :disabled="selectableAll.length === 0"
        @update:checked="toggleAll"
      >
        {{ S('report.selectAll') }}
      </n-checkbox>
      <n-input
        v-model:value="query"
        class="search"
        size="small"
        clearable
        :placeholder="S('report.searchPlaceholder')"
      />
      <span class="summary">{{ summary }}</span>
      <n-button
        size="small"
        type="error"
        :disabled="deleting || selected.length === 0"
        @click="onDeleteClick"
      >
        {{ S('report.deleteSelected') }}
      </n-button>
      <n-button
        size="tiny"
        :color="secondaryButton.bg"
        :text-color="secondaryButton.fg"
        @click="locale = locale === 'en' ? 'zh-cn' : 'en'"
      >
        {{ locale === 'en' ? '中文' : 'English' }}
      </n-button>
    </div>

    <SectionCard
      v-for="s in sectionsView"
      v-show="s.visible.length > 0"
      :key="s.key"
      :sec-key="s.key"
      :rows="s.visible"
      :sort="sortFor(s.key)"
      :expanded="isExpanded(s.key)"
      :checked="checked"
      :count-left="s.count"
      :total-bytes="s.bytes"
      @toggle="toggle"
      @rowcheck="onRowCheck"
      @sectioncheck="onSectionCheck"
      @rowclick="onRowClick"
      @sortchange="onSortChange"
      @copy="onCopy"
    />

    <div class="status">{{ status }}</div>

    <n-modal
      :show="confirmOpen"
      preset="dialog"
      type="warning"
      :title="S('report.title')"
      :positive-text="S('report.confirmYes')"
      :negative-text="S('report.confirmNo')"
      :mask-closable="false"
      @positive-click="doDelete"
      @negative-click="confirmOpen = false"
      @close="confirmOpen = false"
    >
      {{ confirmText }}
    </n-modal>
  </n-config-provider>
</template>
