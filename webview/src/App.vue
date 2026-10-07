<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue';
import {
  NButton,
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
const status = ref('');
const confirmOpen = ref(false);

const rowsBySection = computed<Record<SectionKey, RowVM[]>>(() => {
  const map = Object.fromEntries(SECTIONS.map((k) => [k, [] as RowVM[]])) as Record<SectionKey, RowVM[]>;
  props.items.forEach((item, idx) => {
    map[item.kind as SectionKey]?.push(toRowVM(item, idx, deleted.value.has(idx)));
  });
  return map;
});

interface SectionView {
  key: SectionKey;
  /** 命中搜索的本分区全部行（含已删除行，删除行以禁用态展示） */
  visible: RowVM[];
  /** 可勾选（命中搜索且未删除）行的 idx 集合 */
  selectableIdx: Set<number>;
  /** 分区计数（未删除行数，不随搜索变化） */
  count: number;
  /** 分区总大小（未删除行，不随搜索变化） */
  bytes: number;
}

/**
 * 每分区单次遍历统计（计数/总大小/搜索命中），并按总大小降序排出展示顺序（大分区优先）。
 * 零命中的分区整卡隐藏，避免成排的 "No Data" 空态。
 */
const sectionsView = computed<SectionView[]>(() => {
  const list = SECTIONS.map((key) => {
    const rows = rowsBySection.value[key];
    const visible: RowVM[] = [];
    const selectableIdx = new Set<number>();
    let count = 0;
    let bytes = 0;
    let allBytes = 0;
    for (const r of rows) {
      allBytes += r.item.sizeBytes;
      const hit = rowMatches(r, q.value);
      if (hit) visible.push(r);
      if (!r.deleted) {
        count += 1;
        bytes += r.item.sizeBytes;
        if (hit) selectableIdx.add(r.idx);
      }
    }
    return { key, visible, selectableIdx, count, bytes, allBytes };
  });
  list.sort((a, b) => b.allBytes - a.allBytes);
  return list;
});

function isExpanded(key: string): boolean {
  return !userCollapsed.value[key] || q.value.length > 0;
}

function toggle(key: string): void {
  userCollapsed.value[key] = !userCollapsed.value[key];
}

/** 已勾选且当前有效的行：未删除、命中搜索、分区展开。折叠分区的勾选不计入删除。 */
const selected = computed<RowVM[]>(() => {
  const out: RowVM[] = [];
  for (const s of sectionsView.value) {
    if (!isExpanded(s.key)) continue;
    for (const r of s.visible) {
      if (!r.deleted && checked.value.has(r.idx)) out.push(r);
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
  // 表格只回传本分区可见行的勾选结果；只重置本分区可勾选行，
  // 其他分区与搜索隐藏行的勾选保持不变
  const sec = sectionsView.value.find((s) => s.key === key);
  const reset = sec ? sec.selectableIdx : new Set<number>();
  const next = new Set([...checked.value].filter((i) => !reset.has(i)));
  for (const k of keys) next.add(k);
  checked.value = next;
}

const confirmPreview = computed(() => {
  const labels = selected.value.slice(0, CONFIRM_PREVIEW).map((r) => r.item.label);
  let preview = labels.join(', ');
  if (selected.value.length > CONFIRM_PREVIEW) {
    preview += ' (' + S('report.confirmMore').replace('{n}', String(selected.value.length - CONFIRM_PREVIEW)) + ')';
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
  if (deleting.value) return;
  if (selected.value.length === 0) {
    status.value = S('report.noSelection');
    return;
  }
  status.value = '';
  confirmOpen.value = true;
}

function doDelete(): void {
  confirmOpen.value = false;
  deleting.value = true;
  status.value = S('report.deleting');
  vscode.postMessage({ command: 'delete', indices: selected.value.map((r) => r.idx), locale: locale.value });
}

function onCopy(path: string): void {
  vscode.postMessage({ command: 'copy', text: path, locale: locale.value });
}

function onHostMessage(e: MessageEvent): void {
  const msg = e.data as { command?: string } & Partial<HostToWebviewMessage>;
  if (msg.command !== 'result') return;
  for (const i of msg.deletedIndices ?? []) deleted.value.add(i);
  deleting.value = false;
  status.value =
    S('report.doneFreed') + ' ' + formatBytes(msg.freedBytes ?? 0) +
    (msg.errorCount ? ', ' + msg.errorCount + ' ' + S('report.andFailed') : '');
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
        :disabled="deleting"
        :color="secondaryButton.bg"
        :text-color="secondaryButton.fg"
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
      v-show="!q || s.visible.length > 0"
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
