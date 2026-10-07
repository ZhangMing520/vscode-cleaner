<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue';
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
import { rowMatches, toRowVM, type RowVM } from './rows';
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
const checked = ref<Set<number>>(new Set());
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
  /** 命中搜索的本分区行 */
  visible: RowVM[];
  /** 分区行数（不随搜索变化） */
  count: number;
  /** 分区总大小（不随搜索变化），兼作排序键 */
  bytes: number;
}

/**
 * 每分区单次遍历统计（总大小/搜索命中），并按总大小降序排出展示顺序（大分区优先）。
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
    return { key, visible, count: rows.length, bytes };
  });
  list.sort((a, b) => b.bytes - a.bytes);
  return list;
});

function isExpanded(key: string): boolean {
  return !userCollapsed.value[key] || q.value.length > 0;
}

function toggle(key: string): void {
  userCollapsed.value[key] = !userCollapsed.value[key];
}

/** 已勾选的全部行：计数始终如实反映勾选状态，折叠与搜索不使其"消失"。
 * 误删风险由确认弹窗（预览将删项目与总量）兜底，而非隐藏勾选。 */
const selected = computed<RowVM[]>(() => {
  const out: RowVM[] = [];
  for (const key of SECTIONS) {
    for (const r of rowsBySection.value[key]) {
      if (checked.value.has(r.idx)) out.push(r);
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

function onSectionCheck(key: SectionKey, keys: number[]): void {
  // 表格只回传本分区可见行的勾选结果：先清本分区可见行再回放命中键，
  // 其他分区与搜索隐藏行的勾选不受影响
  const sec = sectionsView.value.find((s) => s.key === key);
  if (!sec) return;
  for (const r of sec.visible) checked.value.delete(r.idx);
  for (const k of keys) checked.value.add(k);
}

/** 全局全选的作用范围：无搜索时为全部行，搜索时为全部命中行。 */
const selectableAll = computed<number[]>(() =>
  sectionsView.value.flatMap((s) => s.visible.map((r) => r.idx))
);

/** 单趟统计作用域内勾选数，allChecked/someChecked 共用，避免两次展开遍历。 */
const hitState = computed(() => {
  let hits = 0;
  for (const i of selectableAll.value) if (checked.value.has(i)) hits++;
  return { total: selectableAll.value.length, hits };
});
const allChecked = computed(
  () => hitState.value.total > 0 && hitState.value.hits === hitState.value.total
);
const someChecked = computed(() => hitState.value.hits > 0);

function toggleAll(v: boolean): void {
  if (v) {
    const next = new Set(checked.value);
    for (const i of selectableAll.value) next.add(i);
    checked.value = next;
  } else {
    // 取消全选语义为"清空全部勾选"（含搜索隐藏行的勾选），否则全局框会永远停在半选态
    checked.value = new Set();
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
  // 同一循环内维护两个集合：已删行从勾选集中就地剔除，避免 checked 累积失效 idx
  for (const i of msg.deletedIndices ?? []) {
    deleted.value.add(i);
    checked.value.delete(i);
  }
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
      :expanded="isExpanded(s.key)"
      :checked="checked"
      :count-left="s.count"
      :total-bytes="s.bytes"
      @toggle="toggle(s.key)"
      @check="(keys: number[]) => onSectionCheck(s.key, keys)"
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
