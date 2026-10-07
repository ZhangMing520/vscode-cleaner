# AGENTS.md

Guidance for AI agents working in this repository (the **vscode-cleaner** VS Code extension).

## What this project is
A VS Code extension that finds and cleans up disk space VS Code does **not** auto-clean:
1. **ipch** — C/C++ IntelliSense precompiled-header cache (`vscode-cpptools/ipch`). The core selling point (competitors don't cover it).
2. **Old extension versions** — leftover `<id>-<version>` folders under `~/.vscode/extensions`, excluding the active version.
3. **Orphaned workspaceStorage** — `User/workspaceStorage/<hash>` whose original folder/`.code-workspace` no longer exists on disk.
4. **CachedData** — VS Code's own V8/Electron code cache (`CachedData/<hash>`). NOTE: this is **not** per-extension and cannot be mapped to a specific extension; present it as one aggregate concept.

All deletions go to the system **Recycle Bin / Trash** (`vscode.workspace.fs.delete(..., { useTrash: true })`). There is no permanent-delete fallback by design.

## Commands / how to run
- Build: `npm run compile` (runs `tsc`). Watch: `npm run watch`.
- Test in a fresh VS Code: press **F5** → choose the **Extension Development Host** debugger. Run the command palette command **`VS Code Cleaner: Scan and Clean`** (command id `vscode-cleaner.scanAndClean`).
- Type-check: `npx tsc --noEmit -p ./`.

## Source layout (`src/`)
- `paths.ts` — `resolveRoots()`: resolves the two platform-specific data roots (Extensions Root `~/.vscode/extensions` and User Data Root, which contains `CachedData` / `User/workspaceStorage`) and the ipch cache dir, using `os.homedir()` + env vars (`APPDATA`/`LOCALAPPDATA`/`XDG_CONFIG_HOME`/`XDG_CACHE_HOME`). Never hardcode absolute paths.
- `types.ts` — `CleanupItem` (path, sizeBytes, kind, label, mtime) and `CleanupKind` union (`'ipch' | 'extension' | 'workspaceStorage' | 'cachedData'`). Section keys in `report.ts` must stay in sync with these kind values.
- `fs.ts` — `calcDirSize`, `dirMtime`, `listSubdirs` (guarded; returns `[]` on error). Use `listSubdirs` instead of hand-rolling `readdir` in new scanners.
- `ipch.ts` / `extensions.ts` / `workspace.ts` — the three scanners. Each returns `{ items, totalBytes }` and never throws (returns empty on missing dirs).
- `cleanup.ts` — `deleteItems()`: moves items to trash; returns `{ deleted, freedBytes, errors }`.
- `report.ts` — `showReport()`: renders the entire webview report as one HTML string containing an embedded `<script>` (sections, sorting, search, collapsible sections, in-page language switch, delete loop). This file is large and mixes templating with behavior — edit carefully.
- `i18n/` — `en.ts` + `zh-cn.ts` bundles, `index.ts` (`t`/`tWith`/`getAllBundles`/`defaultLocale`). Add new UI strings to **both** bundles. The webview switches language live via the injected `LANGS`.
- `extension.ts` — entry point: registers the command, calls `collectItems()` (runs all scanners), then `showReport()`.

## Conventions & constraints
- **Scanner pattern**: list subdirs with `listSubdirs`, compute `calcDirSize` + `dirMtime` per item, push a `CleanupItem`. Keep scanners side-effect-free and non-throwing.
- **Conservative deletion**:
  - Old extensions: only flag a version as cleanable when the active version is known (read default `extensions/extensions.json` + per-profile `User/profiles/<id>/extensions.json`); never touch active/multi-profile versions.
  - workspaceStorage: only orphan caches (original project gone) — never delete project folders.
  - CachedData: all safe to delete as a whole.
- **i18n**: every user-visible string lives in the language bundles. No hardcoded English/Chinese in `report.ts` body.
- **Webview safety**: inject data as `JSON.stringify(x).replace(/</g, '\\u003c')`; build DOM with `textContent` (no innerHTML with external data) to avoid XSS.
- **No git repo** in this workspace — use `npx tsc --noEmit` for verification; there is no CI.

## Gotchas (from prior debugging)
- `CachedData` dirs are 40-char hashes of V8 script paths — do NOT try to label them per-extension; it isn't possible.
- Section collapse state in `report.ts` uses two fields: `collapsed` (effective, transiently overridden during search) and `userCollapsed` (user intent, restored when the search box is cleared). Keep that distinction if editing search/collapse logic.
- The host message handler posts back only **successfully** deleted indices (`deletedIndices`); the webview must not mark failed deletes as removed.
