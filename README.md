# VS Code Cleaner

A VS Code extension that cleans up disk space VS Code does **not** clean on its own: the C/C++ IntelliSense cache (ipch), leftover old extension versions, cached .vsix installers, the Chromium HTTP cache, session logs, orphaned workspace storage, and VS Code's own code cache.

中文说明见 [README.zh-CN.md](./README.zh-CN.md).

## Features

- **IntelliSense cache (ipch)**: the `vscode-cpptools/ipch` directory — usually the largest and not covered by competitors. Safe to delete as a whole; the C/C++ extension rebuilds it automatically the next time you open the workspace (first open may be slower). Your code and settings are unaffected. The report shows the current cache size with pointers to `C_Cpp.intelliSenseCacheSize` (cap the growth) and `C_Cpp.intelliSenseCachePath` (relocate to a bigger drive).
- **Old extension versions**: leftover `<id>-<version>` folders under `~/.vscode/extensions` after updates. Only **inactive** versions are flagged (the active version is detected from the default profile and each named profile's `extensions.json`); the version currently in use is never removed.
- **Orphaned workspace storage**: entries in `User/workspaceStorage/<hash>` whose original folder or `.code-workspace` file no longer exists on disk. Only VS Code's cached state is removed — **your actual project folders are never touched**.
- **Code cache (CachedData)**: VS Code's own V8/Electron code cache. The directory names are internal hashes of script paths and **do not map to a specific extension**; the whole folder is safe to delete and is rebuilt on next launch.
- **Cached extension VSIXs**: the `.vsix` packages downloaded when extensions update — useless after installation and never cleaned by VS Code. Each is safe to delete individually and re-downloaded only if you reinstall that extension.
- **HTTP cache (Cache)**: Chromium's disk cache (marketplace assets, icons, webview resources). Listed per child entry so entries still locked by the running VS Code fail individually without blocking the rest; space returns after a restart.
- **Session logs**: one timestamped folder per launch, growing forever. Pure logs; the running session is never listed.

All deletions go to the system **Recycle Bin / Trash** (`useTrash: true`) and can be recovered. There is no permanent-delete fallback.

## Install

- Install from the VS Code Marketplace by searching **VS Code Cleaner** (once published), or build and install locally:
  ```bash
  npm install
  npx @vscode/vsce package   # runs compile + webview build via vscode:prepublish, produces a .vsix
  ```
  Then install the `.vsix` via "Install from VSIX" in VS Code.

## Usage

1. Open the Command Palette (Ctrl/Cmd+Shift+P) and run **`VS Code Cleaner: Scan and Clean`**.
2. The report page is split into seven sections by type and supports:
   - Column sorting (Name / Type / Size / Modified)
   - Draggable column widths
   - Keyword filtering (by name or path — matching rows are shown and their section auto-expanded; search never changes your selection)
   - Global select-all in the toolbar (when searching, it covers the matching rows); the checked count always reflects your selection, even with sections folded
   - Section collapsing (click a section title to fold/expand)
   - In-page language switch (English / 简体中文, top-right)
   - Click anywhere on a row to toggle its selection (clicking the path cell copies the full path instead); **Shift+click selects the whole range** from the last clicked row, across sections
3. Select the items to clean → **Delete selected** → confirm. Items are moved to the Recycle Bin and the freed space is reported.

## Settings

- `vscode-cleaner.minSizeMB` (default `0`): when the total cleanable size is below this value (MB), only an information message is shown and the detailed report is skipped; `0` means the report is always opened.

## Safety

- Only cache/log data is removed: inactive old extension versions, orphaned workspace caches, ipch, CachedData, cached .vsix installers, the HTTP cache, and old session logs. Active extensions, project folders, and the running extension host are never touched.
- Deletions go to the Recycle Bin with no permanent-delete fallback, so mistakes are recoverable.
- Paths are resolved per platform (`APPDATA` / `LOCALAPPDATA` / `XDG_CONFIG_HOME` / `XDG_CACHE_HOME`) and honor `--user-data-dir`.

## Development

```bash
npm install
npm run compile           # type-check and compile the host to out/
npm run watch             # watch and recompile the host
npm run webview:build     # bundle the webview (Vue 3 + Vite + Naive UI) to media/
npm run webview:typecheck # vue-tsc type-check for webview/
npm test                  # run unit tests (vitest)
```

Debug: press F5 and choose the **Extension Development Host** debugger, then run the command in the new window.

## License

[MIT](./LICENSE)
