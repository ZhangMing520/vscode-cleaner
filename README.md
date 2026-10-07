# VS Code Cleaner

A VS Code extension that cleans up disk space VS Code does **not** clean on its own: the C/C++ IntelliSense cache (ipch) and leftover old extension versions, plus orphaned workspace storage and VS Code's own code cache.

中文说明见 [README.zh-CN.md](./README.zh-CN.md).

## Features

- **IntelliSense cache (ipch)**: the `vscode-cpptools/ipch` directory — usually the largest and not covered by competitors. Safe to delete as a whole; the C/C++ extension rebuilds it automatically the next time you open the workspace (first open may be slower). Your code and settings are unaffected.
- **Old extension versions**: leftover `<id>-<version>` folders under `~/.vscode/extensions` after updates. Only **inactive** versions are flagged (the active version is detected from the default profile and each named profile's `extensions.json`); the version currently in use is never removed.
- **Orphaned workspace storage**: entries in `User/workspaceStorage/<hash>` whose original folder or `.code-workspace` file no longer exists on disk. Only VS Code's cached state is removed — **your actual project folders are never touched**.
- **Code cache (CachedData)**: VS Code's own V8/Electron code cache. The directory names are internal hashes of script paths and **do not map to a specific extension**; the whole folder is safe to delete and is rebuilt on next launch.

All deletions go to the system **Recycle Bin / Trash** (`useTrash: true`) and can be recovered. There is no permanent-delete fallback.

## Install

- Install from the VS Code Marketplace by searching **VS Code Cleaner** (once published), or build and install locally:
  ```bash
  npm install
  npm run compile
  vsce package   # produces a .vsix; install via "Install from VSIX" in VS Code
  ```

## Usage

1. Open the Command Palette (Ctrl/Cmd+Shift+P) and run **`VS Code Cleaner: Scan and Clean`**.
2. The report page is split into four sections by type and supports:
   - Column sorting (Name / Type / Size / Modified)
   - Keyword filtering (by name or path — matching rows are auto-selected and their section auto-expanded)
   - Section collapsing (click a section title to fold/expand)
   - In-page language switch (English / 简体中文, top-right)
3. Select the items to clean → **Delete selected** → confirm. Items are moved to the Recycle Bin and the freed space is reported.

## Settings

- `vscode-cleaner.minSizeMB` (default `0`): when the total cleanable size is below this value (MB), only an information message is shown and the detailed report is skipped; `0` means the report is always opened.

## Safety

- Only inactive old extension versions, orphaned workspace caches, ipch, and CachedData are removed. Active extensions, project folders, and the running extension host are never touched.
- Deletions go to the Recycle Bin with no permanent-delete fallback, so mistakes are recoverable.
- Paths are resolved per platform (`APPDATA` / `LOCALAPPDATA` / `XDG_CONFIG_HOME` / `XDG_CACHE_HOME`) and honor `--user-data-dir`.

## Development

```bash
npm install
npm run compile      # type-check and compile to out/
npm run watch        # watch and recompile
npm test             # run scanner unit tests (vitest)
```

Debug: press F5 and choose the **Extension Development Host** debugger, then run the command in the new window.

## License

[MIT](./LICENSE)
