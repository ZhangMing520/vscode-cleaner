import * as vscode from 'vscode';
import * as crypto from 'crypto';
import { CleanupItem } from './types';
import { deleteItems } from './cleanup';
import { formatBytes } from './format';
import { t, tWith, getAllBundles, defaultLocale } from './i18n';

const SECTIONS: Array<{ key: string }> = [
  { key: 'ipch' },
  { key: 'extension' },
  { key: 'workspaceStorage' },
  { key: 'cachedData' },
];

/** 打开 Webview 报告页：分区表格 + 排序 + 搜索 + 语言切换 + 页内确认 + 回收站删除。 */
export function showReport(items: CleanupItem[]): void {
  const panel = vscode.window.createWebviewPanel(
    'vscodeCleanerReport',
    t('report.title'),
    vscode.ViewColumn.One,
    { enableScripts: true, retainContextWhenHidden: true }
  );

  const nonce = crypto.randomBytes(16).toString('hex');
  const langs = getAllBundles();
  const defLocale = defaultLocale();
  panel.webview.html = renderHtml(items, nonce, panel.webview.cspSource, langs, defLocale);

  panel.webview.onDidReceiveMessage(async (msg: { command: string; indices?: number[]; locale?: string }) => {
    if (msg.command !== 'delete' || !msg.indices || msg.indices.length === 0) {
      return;
    }
    const indices = msg.indices;

    const chosen = indices.map((i) => items[i]).filter(Boolean);
    const channel = vscode.window.createOutputChannel('VS Code Cleaner');
    channel.appendLine(`Deleting ${chosen.length} items...`);

    const result = await deleteItems(chosen);
    for (const err of result.errors) {
      channel.appendLine(`  FAILED ${err.path}: ${err.message}`);
    }
    channel.appendLine(`  done: deleted ${result.deleted}, freed ${result.freedBytes}`);

    const failedPaths = new Set(result.errors.map((e) => e.path));
    const deletedIndices: number[] = [];
    chosen.forEach((c, k) => {
      if (!failedPaths.has(c.path)) deletedIndices.push(indices[k]);
    });

    panel.webview.postMessage({
      command: 'result',
      deletedIndices: deletedIndices,
      deleted: result.deleted,
      freedBytes: result.freedBytes,
      errorCount: result.errors.length,
    });

    if (result.errors.length === 0) {
      vscode.window.showInformationMessage(
        tWith(msg.locale || defLocale, 'ext.cleaned', { n: result.deleted, size: formatBytes(result.freedBytes) })
      );
    } else {
      vscode.window.showWarningMessage(
        tWith(msg.locale || defLocale, 'ext.failed', { n: result.deleted, m: result.errors.length })
      );
    }
  });
}

function renderHtml(
  items: CleanupItem[],
  nonce: string,
  cspSource: string,
  LANGS: Record<string, Record<string, string>>,
  defaultLocale: string
): string {
  const data = JSON.stringify(items).replace(/</g, '\\u003c');
  const langsJson = JSON.stringify(LANGS).replace(/</g, '\\u003c');
  const sections = JSON.stringify(SECTIONS);

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy"
  content="default-src 'none'; img-src ${cspSource} https:; script-src 'nonce-${nonce}'; style-src 'nonce-${nonce}';">
<style nonce="${nonce}">
  :root { color-scheme: light dark; }
  body { font-family: var(--vscode-font-family, sans-serif); padding: 16px 20px; }
  h1 { font-size: 18px; margin: 0 0 4px; }
  .sub { color: var(--vscode-descriptionForeground); margin: 0 0 16px; font-size: 12px; }
  #toolbar { display: flex; align-items: center; gap: 12px; margin-bottom: 12px; }
  #search { flex: 1; padding: 5px 8px; font-size: 13px; border-radius: 3px;
    background: var(--vscode-input-background); color: var(--vscode-input-foreground);
    border: 1px solid var(--vscode-input-border); }
  #lang { padding: 4px 6px; font-size: 13px; border-radius: 3px;
    background: var(--vscode-input-background); color: var(--vscode-input-foreground);
    border: 1px solid var(--vscode-input-border); }
  #summary { font-weight: 600; white-space: nowrap; }
  button { background: var(--vscode-button-background); color: var(--vscode-button-foreground);
    border: none; padding: 4px 12px; border-radius: 3px; cursor: pointer; font-size: 13px; }
  button:disabled { opacity: .5; cursor: default; }
  #deleteBtn { background: var(--vscode-button-secondaryBackground); color: var(--vscode-button-secondaryForeground); }
  .section { margin-bottom: 20px; }
  .section h2 { font-size: 14px; margin: 0 0 2px; }
  .section h2 .count { opacity: .6; font-weight: normal; font-size: 12px; }
  .section h2 { cursor: pointer; user-select: none; }
  .section .toggle { display: inline-block; width: 12px; margin-right: 6px; }
  .section.collapsed .desc, .section.collapsed .selall, .section.collapsed table { display: none; }
  .desc { color: var(--vscode-descriptionForeground); font-size: 12px; margin: 2px 0 8px; line-height: 1.4; }
  .tip { color: var(--vscode-descriptionForeground); font-size: 12px; margin: 0 0 8px; padding: 4px 8px; border-left: 2px solid var(--vscode-textLink-foreground); background: var(--vscode-editorWidget-background); }
  .selall { display: inline-block; margin: 2px 0 8px; font-size: 12px; }
  table { width: 100%; border-collapse: collapse; font-size: 13px; }
  th, td { text-align: left; padding: 6px 8px; border-bottom: 1px solid var(--vscode-panel-border); }
  th { color: var(--vscode-foreground); opacity: .8; }
  th.sortable { cursor: pointer; user-select: none; }
  th.sort-asc::after { content: ' \\25B2'; }
  th.sort-desc::after { content: ' \\25BC'; }
  td.path { color: var(--vscode-descriptionForeground); max-width: 320px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  tr.deleted td { text-decoration: line-through; opacity: .5; }
  #confirm { margin: 14px 0; padding: 10px 12px; border: 1px solid var(--vscode-panel-border); border-radius: 4px; display: none; }
  #confirm.show { display: block; }
  #confirm button { margin-right: 8px; }
  #status { margin-top: 12px; font-weight: 600; }
</style>
</head>
<body>
  <h1 id="pageTitle"></h1>
  <p class="sub" id="pageSub"></p>

  <div id="toolbar">
    <input type="text" id="search">
    <span id="summary"></span>
    <button id="deleteBtn"></button>
    <select id="lang">
      <option value="en">English</option>
      <option value="zh-cn">简体中文</option>
    </select>
  </div>

  <div id="sections"></div>

  <div id="confirm">
    <span id="confirmText"></span>
    <button id="confirmYes"></button>
    <button id="confirmNo"></button>
  </div>

  <div id="status"></div>

<script nonce="${nonce}">
  const ITEMS = ${data};
  const LANGS = ${langsJson};
  const SECTIONS = ${sections};
  let currentLocale = ${JSON.stringify(defaultLocale)};

  function S(key) {
    const b = LANGS[currentLocale] || LANGS.en;
    return (b && b[key]) || LANGS.en[key] || key;
  }

  function formatBytes(b) {
    if (b < 1024) return b + ' B';
    const u = ['KB','MB','GB','TB']; let v = b/1024, i = 0;
    while (v >= 1024 && i < u.length-1) { v /= 1024; i++; }
    return v.toFixed(2) + ' ' + u[i];
  }

  function fmtDate(ms) {
    if (!ms) return '—';
    const loc = currentLocale === 'zh-cn' ? 'zh-CN' : 'en-US';
    return new Date(ms).toLocaleString(loc, { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
  }

  function sectionKey(kind) {
    return kind;
  }

  const sectionsEl = document.getElementById('sections');
  const pageTitle = document.getElementById('pageTitle');
  const pageSub = document.getElementById('pageSub');
  const summary = document.getElementById('summary');
  const deleteBtn = document.getElementById('deleteBtn');
  const search = document.getElementById('search');
  const langSelect = document.getElementById('lang');
  const confirmBox = document.getElementById('confirm');
  const confirmText = document.getElementById('confirmText');
  const confirmYes = document.getElementById('confirmYes');
  const confirmNo = document.getElementById('confirmNo');
  const status = document.getElementById('status');

  const rows = [];
  const selAllByKey = {};
  const sections = [];

  function isVisible(r) { return !r.sec.collapsed && r.tr.style.display !== 'none'; }
  function visibleRowsInSection(key) {
    return rows.filter(function (r) { return sectionKey(r.kind) === key && isVisible(r); });
  }
  function syncSectionSelectAll(key) {
    const list = visibleRowsInSection(key);
    selAllByKey[key].checked = list.length > 0 && list.every(function (r) { return r.cb.checked; });
  }

  function applyCollapsed(s, collapsed) {
    s.collapsed = collapsed;
    s.wrap.classList.toggle('collapsed', collapsed);
    s.toggle.textContent = collapsed ? '▸' : '▾';
  }

  function sortVal(r, key) {
    if (key === 'size') return r.size;
    if (key === 'name') return r.label.toLowerCase();
    if (key === 'type') return S('type.' + r.kind).toLowerCase();
    if (key === 'modified') return r.mtime;
    if (key === 'path') return r.path.toLowerCase();
    return 0;
  }

  function renderSection(sec) {
    sec.tbody.innerHTML = '';
    const arr = sec.rows.slice().sort(function (a, b) {
      const va = sortVal(a, sec.sort.key), vb = sortVal(b, sec.sort.key);
      const cmp = (typeof va === 'number') ? va - vb : (va < vb ? -1 : (va > vb ? 1 : 0));
      return sec.sort.dir === 'asc' ? cmp : -cmp;
    });
    arr.forEach(function (r) { sec.tbody.appendChild(r.tr); });
    sec.headers.forEach(function (h) {
      h.classList.remove('sort-asc', 'sort-desc');
      if (h.dataset.col === sec.sort.key) h.classList.add(sec.sort.dir === 'asc' ? 'sort-asc' : 'sort-desc');
    });
  }

  function applyLocale() {
    pageTitle.textContent = S('report.title');
    pageSub.textContent = S('report.subtitle');
    search.placeholder = S('report.searchPlaceholder');
    deleteBtn.textContent = S('report.deleteSelected');
    confirmYes.textContent = S('report.confirmYes');
    confirmNo.textContent = S('report.confirmNo');
    sections.forEach(function (sec) {
      sec.titleText.textContent = S('section.' + sec.key);
      sec.descEl.textContent = S('desc.' + sec.key) || '';
      const tipText = S('tip.' + sec.key) || '';
      sec.tipEl.textContent = tipText;
      sec.tipEl.style.display = tipText ? '' : 'none';
      sec.headers.forEach(function (h) { if (h.dataset.col) h.textContent = S('col.' + h.dataset.col); });
      sec.rows.forEach(function (r) { r.typeCell.textContent = S('type.' + r.kind) || r.kind; });
      sec.rows.forEach(function (r) { if (r.modCell) r.modCell.textContent = fmtDate(r.mtime); });
    });
    update();
  }

  SECTIONS.forEach(function (secDef) {
    const secKey = secDef.key;
    const secItems = ITEMS.filter(function (it) { return sectionKey(it.kind) === secKey; });

    const wrap = document.createElement('div'); wrap.className = 'section';
    const h2 = document.createElement('h2');
    const toggle = document.createElement('span'); toggle.className = 'toggle';
    toggle.textContent = '▾';
    const titleText = document.createElement('span'); titleText.className = 'titleText';
    const count = document.createElement('span'); count.className = 'count';
    count.textContent = '(' + secItems.length + ')';
    h2.appendChild(toggle); h2.appendChild(titleText); h2.appendChild(count);

    const desc = document.createElement('p'); desc.className = 'desc';
    const tip = document.createElement('p'); tip.className = 'tip';

    const selAllLbl = document.createElement('label'); selAllLbl.className = 'selall';
    const selAll = document.createElement('input'); selAll.type = 'checkbox'; selAll.checked = false; selAll.dataset.section = secKey;
    selAllLbl.appendChild(selAll); selAllLbl.appendChild(document.createTextNode(' ' + S('report.selectAll')));
    selAllByKey[secKey] = selAll;

    const table = document.createElement('table');
    const thead = document.createElement('thead');
    const headRow = document.createElement('tr');
    const cols = [['', ''], ['name', S('col.name')], ['type', S('col.type')], ['size', S('col.size')], ['path', S('col.path')], ['modified', S('col.modified')]];
    const headers = [];
    cols.forEach(function (c) {
      const th = document.createElement('th');
      if (c[0]) { th.className = 'sortable'; th.dataset.col = c[0]; }
      th.textContent = c[1];
      headRow.appendChild(th);
      if (c[0]) headers.push(th);
    });
    thead.appendChild(headRow); table.appendChild(thead);
    const tbody = document.createElement('tbody'); table.appendChild(tbody);

    wrap.appendChild(h2); wrap.appendChild(desc); wrap.appendChild(tip); wrap.appendChild(selAllLbl); wrap.appendChild(table);
    sectionsEl.appendChild(wrap);

    const sec = { key: secKey, tbody: tbody, headers: headers, titleText: titleText, descEl: desc, tipEl: tip, countEl: count, rows: [], sort: { key: 'size', dir: 'desc' }, collapsed: false, userCollapsed: false, wrap: wrap, toggle: toggle };
    sections.push(sec);

    h2.addEventListener('click', function () {
      sec.userCollapsed = !sec.userCollapsed;
      applyCollapsed(sec, sec.userCollapsed);
      update();
    });

    secItems.forEach(function (it) {
      const idx = ITEMS.indexOf(it);
      const tr = document.createElement('tr');
      const cb = document.createElement('input'); cb.type = 'checkbox'; cb.className = 'rowcb';
      cb.checked = false; cb.dataset.index = idx;
      cb.addEventListener('change', function () { syncSectionSelectAll(secKey); update(); });
      const tdCb = document.createElement('td'); tdCb.appendChild(cb);

      const tdName = document.createElement('td'); tdName.textContent = it.label;
      const tdType = document.createElement('td');
      const tdSize = document.createElement('td'); tdSize.textContent = formatBytes(it.sizeBytes);
      const tdMod = document.createElement('td'); tdMod.textContent = fmtDate(it.mtime);
      const tdPath = document.createElement('td'); tdPath.className = 'path';
      tdPath.textContent = it.path; tdPath.title = it.path;

      tr.appendChild(tdCb); tr.appendChild(tdName); tr.appendChild(tdType); tr.appendChild(tdSize); tr.appendChild(tdPath); tr.appendChild(tdMod);
      tbody.appendChild(tr);
      const model = { tr: tr, cb: cb, sizeCell: tdSize, modCell: tdMod, typeCell: tdType, size: it.sizeBytes, mtime: it.mtime, kind: it.kind, label: it.label, path: it.path, idx: idx, sec: sec };
      rows.push(model); sec.rows.push(model);
    });

    headers.forEach(function (th) {
      th.addEventListener('click', function () {
        const col = th.dataset.col;
        if (sec.sort.key === col) {
          sec.sort.dir = sec.sort.dir === 'asc' ? 'desc' : 'asc';
        } else {
          sec.sort.key = col;
          sec.sort.dir = (col === 'size') ? 'desc' : 'asc';
        }
        renderSection(sec);
      });
    });

    selAll.addEventListener('change', function () {
      visibleRowsInSection(secKey).forEach(function (r) { r.cb.checked = selAll.checked; });
      update();
    });

    renderSection(sec);
  });

  function selectedIndices() {
    return rows.filter(function (r) { return isVisible(r) && r.cb.checked; })
      .map(function (r) { return r.idx; });
  }

  function update() {
    const sel = selectedIndices();
    let total = 0;
    sel.forEach(function (i) { total += ITEMS[i].sizeBytes; });
    summary.textContent = sel.length + ' ' + S('report.itemsWord') + ' · ' + formatBytes(total);
  }

  search.addEventListener('input', function () {
    const q = search.value.trim().toLowerCase();
    const hasQuery = q.length > 0;
    rows.forEach(function (r) {
      const name = r.label.toLowerCase();
      const path = r.path.toLowerCase();
      const hit = !q || name.indexOf(q) !== -1 || path.indexOf(q) !== -1;
      r.tr.style.display = hit ? '' : 'none';
      r.cb.checked = hasQuery ? hit : false;
    });
    // 搜索框非空时展开所有分区（无论逐字输入还是粘贴，最终态一致）；
    // 清空搜索时还原为用户原来的折叠状态
    if (hasQuery) {
      sections.forEach(function (s) { if (s.collapsed) applyCollapsed(s, false); });
    } else {
      sections.forEach(function (s) { applyCollapsed(s, s.userCollapsed); });
    }
    sections.forEach(function (s) { syncSectionSelectAll(s.key); });
    update();
  });

  deleteBtn.addEventListener('click', function () {
    const sel = selectedIndices();
    if (sel.length === 0) { status.textContent = S('report.noSelection'); return; }
    let total = 0; sel.forEach(function (i) { total += ITEMS[i].sizeBytes; });
    confirmText.textContent = S('report.confirmPrefix') + ' ' + sel.length + ' ' + S('report.confirmSuffix') +
      ' (' + formatBytes(total) + ')? ' + S('report.confirmNote');
    confirmBox.classList.add('show');
  });

  confirmNo.addEventListener('click', function () { confirmBox.classList.remove('show'); });

  confirmYes.addEventListener('click', function () {
    const sel = selectedIndices();
    confirmBox.classList.remove('show');
    deleteBtn.disabled = true;
    status.textContent = S('report.deleting');
    vscode.postMessage({ command: 'delete', indices: sel, locale: currentLocale });
  });

  langSelect.value = currentLocale;
  langSelect.addEventListener('change', function () {
    currentLocale = langSelect.value;
    applyLocale();
  });

  window.addEventListener('message', function (e) {
    const msg = e.data;
    if (msg.command !== 'result') return;
    msg.deletedIndices.forEach(function (i) {
      const r = rows.find(function (x) { return x.idx === i; });
      if (!r) return;
      r.cb.disabled = true; r.cb.checked = false; r.tr.classList.add('deleted');
      r.sizeCell.textContent = S('report.deletedCell');
    });
    sections.forEach(function (s) {
      const left = s.rows.filter(function (r) { return !r.tr.classList.contains('deleted'); }).length;
      s.countEl.textContent = '(' + left + ')';
      syncSectionSelectAll(s.key);
    });
    deleteBtn.disabled = false;
    update();
    status.textContent = S('report.doneFreed') + ' ' + formatBytes(msg.freedBytes) +
      (msg.errorCount ? (', ' + msg.errorCount + ' ' + S('report.andFailed')) : '');
  });

  sections.forEach(function (s) { syncSectionSelectAll(s.key); });
  applyLocale();
  update();
</script>
</body>
</html>`;
}
