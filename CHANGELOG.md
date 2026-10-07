# Changelog

All notable changes to **VS Code Cleaner** are documented here.

## [0.1.1] - 2026-10-08

Marketplace metadata only — no functional change.

- Bilingual, English-first `description` so the listing is discoverable outside Chinese locales.
- More keywords (`cache cleaner`, `free up space`, `unused extensions`, `workspace storage`, `cachedata`, `storage`, `logs`).
- README/AGENTS now document the live listing identifier and how to reach it (`@ext:zhangming520.cache-sweeper`).

## [0.1.0] - 2026-10-07

First public release. Seven kinds of leftovers that VS Code never cleans on its own, all deletions going to the system Recycle Bin / Trash.

- Scanners: C/C++ IntelliSense **ipch** cache, **old extension versions** (inactive ones only, resolved from default and named profile `extensions.json`), **orphaned workspaceStorage**, **CachedData**, **cached VSIX installers**, Chromium **HTTP cache** (per entry, so a locked file cannot block the rest), and **session logs** (running session excluded).
- Report page rebuilt as a Vue 3 + Naive UI app with virtual scrolling, O(1) row selection, resizable columns, controlled sorting, and live theme sync with the editor.
- Selection: click a row to toggle, Shift+click for a cross-section range, per-section and toolbar select-all, checked totals independent of what is currently visible.
- Search filters by name or path and force-expands matching sections without ever changing your selection.
- Click a path cell to copy the full path. Confirm dialog previews the labels and total before anything is removed.
- English / 简体中文 UI switchable in-page; follows the editor language by default.
- `vscode-cleaner.minSizeMB` setting to skip the detailed report below a threshold.
- Failed deletes are reported per item and stay in the list; only successful ones are removed.
