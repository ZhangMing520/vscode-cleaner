# AGENTS.md

Guidance for AI agents working in this repository (the **vscode-cleaner** VS Code extension).

## What this project is
A VS Code extension that finds and cleans up disk space VS Code does **not** auto-clean (7 kinds, grouped by `CleanupKind`):
1. **ipch** — C/C++ IntelliSense precompiled-header cache (`vscode-cpptools/ipch`). The core selling point (competitors don't cover it).
2. **Old extension versions** — leftover `<id>-<version>` folders under `~/.vscode/extensions`, excluding the active version.
3. **Orphaned workspaceStorage** — `User/workspaceStorage/<hash>` whose original folder/`.code-workspace` no longer exists on disk (covers default + named profiles).
4. **CachedData** — VS Code's own V8/Electron code cache (`CachedData/<hash>`). NOTE: this is **not** per-extension and cannot be mapped to a specific extension; present it as one aggregate concept.
5. **cachedVsixs** — `CachedExtensionVSIXs/<id>-<version>.vsix` installers downloaded on extension update; useless after install. Listed per file; skips `.<uuid>` temp files and files younger than 15 min.
6. **codeCache** — Chromium HTTP disk cache (`Cache/`), listed per child entry so locked entries fail individually instead of blocking the whole dir.
7. **logs** — per-session log dirs under `logs/`; mtime is the max mtime of contained files; the running instance's own session dir is skipped.

All deletions go to the system **Recycle Bin / Trash** (`vscode.workspace.fs.delete(..., { useTrash: true })`). There is no permanent-delete fallback by design.

## Commands / how to run
- Build host: `npm run compile` (runs `tsc`). Watch: `npm run watch`.
- Build webview bundle: `npm run webview:build` (Vite → `media/main.js` + `media/main.css`, fixed names, no hash). Watch: `npm run webview:watch`. Type-check: `npm run webview:typecheck` (vue-tsc).
- Test in a fresh VS Code: `npm run webview:build` once, then press **F5** → **Extension Development Host**. Run the command palette command **`VS Code Cleaner: Scan and Clean`** (command id `vscode-cleaner.scanAndClean`).
- Tests: `npm test` (vitest, `test/`). Host type-check: `npx tsc --noEmit -p ./`.
- Package: `npx @vscode/vsce package --no-dependencies --allow-missing-repository --baseContentUrl <placeholder>` (see `.vscodeignore`; ships only `out/**` + `media/main.*`).

## Source layout
- `paths.ts` — `resolveRoots()`: resolves the two platform-specific data roots (Extensions Root `~/.vscode/extensions` and User Data Root) and the ipch cache dir, using `os.homedir()` + env vars (`APPDATA`/`LOCALAPPDATA`/`XDG_CONFIG_HOME`/`XDG_CACHE_HOME`). Never hardcode absolute paths. At runtime `extension.ts` re-derives the **real** user data root from `context.globalStorageUri` so Insiders/`--user-data-dir` instances don't scan another instance's data.
- `types.ts` — `CleanupItem` (path, sizeBytes, kind, label, mtime) and the 7-member `CleanupKind` union. Section keys in `webview/src/App.vue` (`SECTIONS`) must stay in sync with these kind values.
- `fs.ts` — `calcDirSize`, `dirMtime`, `listSubdirs`, `listFiles`, `measureDir` (single-walk size + max-mtime; skips symlinks), `samePath` (case-insensitive on win32). All guarded; use these instead of hand-rolling readdir in new scanners.
- `ipch.ts` / `extensions.ts` / `workspace.ts` — the scanners. Each returns `{ items, totalBytes }` and never throws (returns empty on missing dirs). `extension.ts` runs them all in `Promise.all`.
- `cleanup.ts` — `deleteItems()`: moves items to trash; returns `{ deleted, freedBytes, errors }`.
- `report.ts` — **host side only**: creates the panel, computes `asWebviewUri` asset URIs (fixed names `media/main.js` / `media/main.css`), renders the HTML shell via `renderHtml()` (CSP + bootstrap data + asset tags), and handles `copy` / `delete` messages from the webview. No UI logic lives here anymore.
- `webview/` — the report UI as a Vue 3 + Vite + Naive UI SPA bundled to `media/`:
  - `webview/src/App.vue` — page layout, toolbar (search / summary / delete / language), section state (userCollapsed vs search-forced expand), selection semantics (only visible rows count), confirm modal, host message handling.
  - `webview/src/SectionCard.vue` — one `n-data-table` per section: selection column, resizable columns (fixed pixel widths required), controlled sorter (default size desc), deleted-row rendering, click-to-copy path cell.
  - `webview/src/theme.ts` — maps `--vscode-*` CSS vars onto Naive theme overrides; watches `body.vscode-dark/light/high-contrast` class mutations for live theme switching.
  - `webview/src/i18n.ts` — reactive `locale` + `S()` / `Sopt()` (same fallback semantics as host `i18n/`).
  - `webview/src/bootstrap.ts` — reads `window.__CLEANER__` (`{ items, langs, locale }`) injected by the host's nonce'd inline script.
  - `webview/src/format.ts` — `formatBytes` / `fmtDate` (same algorithm as host `src/format.ts`).
- `i18n/` — `en.ts` + `zh-cn.ts` bundles, `index.ts` (`t`/`tWith`/`getAllBundles`/`defaultLocale`). Add new UI strings to **both** bundles; the webview receives all bundles and switches language live.

## Conventions & constraints
- **Scanner pattern**: list entries with `listSubdirs`/`listFiles`, compute size + mtime, push a `CleanupItem`. Keep scanners side-effect-free and non-throwing.
- **Conservative deletion**:
  - Old extensions: only flag a version as cleanable when the active version is known (read default `extensions/extensions.json` + per-profile `User/profiles/<id>/extensions.json`); never touch active/multi-profile versions.
  - workspaceStorage: only orphan caches (original project gone) — never delete project folders.
  - Everything else is pure cache/log data, safe to delete as a whole.
- **i18n**: every user-visible string lives in the language bundles. No hardcoded English/Chinese in host or webview code.
- **Webview safety**: host injects data as `JSON.stringify(x).replace(/</g, '\\u003c')` into the bootstrap script; the Vue app builds all DOM (no `innerHTML` with external data). Copy-to-clipboard messages are validated against known item paths host-side.
- **CSP**: `script-src` stays strict (`${cspSource}` + nonce for the bootstrap). `style-src` **must** include `'unsafe-inline'` — Naive UI's css-render injects `<style>` tags at runtime and cannot carry a nonce. Do not "tighten" this back without dropping Naive.
- **Asset names**: Vite output is pinned to `main.js` / `main.css` (no content hash) because the host references them by fixed path.

## Verification checklist (host-side test suite covers what it can)
- `test/paths.test.ts` — platform path resolution (mocked `os`/env/platform).
- `test/scanners.test.ts` — all scanners incl. the three newer ones.
- `test/report.test.ts` — rendered host HTML: strict script-src, `style-src` keeps `unsafe-inline`, no inline UI logic, bootstrap data escaped.
- Webview behavior (sorting/search/collapse/selection) is TypeScript-checked (`vue-tsc`) but only exercised by F5 in the Extension Development Host — check there after webview changes.

## Gotchas (from prior debugging)
- `CachedData` dirs are 40-char hashes of V8 script paths — do NOT try to label them per-extension; it isn't possible.
- Collapse state uses two fields: `userCollapsed` (user intent) and effective expand (forced open while the search query is non-empty, restored on clear). Search must **never** auto-check rows — only filter visibility; hidden rows keep their checked state but don't count toward deletion.
- The host message handler posts back only **successfully** deleted indices (`deletedIndices`); the webview must not mark failed deletes as removed.
- Old host behavior (pre-migration): deletion was dead because the inline script used an undefined `vscode` global — the Vue app calls `acquireVsCodeApi()` exactly once in `webview/src/vscode.ts`; there's a test guarding the host HTML against inline-script regressions.
- vitest picks up the root `vite.config.ts` (whose `root` points at `webview/`); `vitest.config.ts` overrides the test root — keep both if you touch build config.
