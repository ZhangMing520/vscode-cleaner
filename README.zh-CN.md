# VS Code Cleaner（中文说明）

清理 VS Code 自身**不主动清理**的磁盘空间：C/C++ IntelliSense 缓存（ipch）、更新残留的旧版扩展、缓存的 .vsix 安装包、Chromium HTTP 缓存、会话日志、孤儿工作区缓存与 VS Code 自身代码缓存。

English documentation: [README.md](./README.md).

## 功能

- **IntelliSense 缓存（ipch）**：`vscode-cpptools/ipch` 目录，通常最大，竞品未覆盖。可整体删除，C/C++ 扩展会在下次打开对应工作区时自动重建（首次略慢），不影响你的代码与设置。
- **旧版扩展**：`~/.vscode/extensions/` 下更新后残留的旧版本目录。仅标记**非激活**版本（读取默认 profile 与各命名 profile 的 `extensions.json` 判定活跃版本），当前正在使用的版本绝不会被删。
- **孤儿工作区存储**：`User/workspaceStorage/<hash>` 中，原项目/`.code-workspace` 已消失的缓存。只删 VS Code 状态，**绝不删项目文件夹本身**。
- **扩展代码缓存（CachedData）**：VS Code 自身的 V8/Electron 代码缓存，目录名为脚本路径的内部哈希，**不对应具体扩展**，可整体安全删除，下次启动自动重建。
- **扩展安装包缓存（CachedExtensionVSIXs）**：扩展更新时下载的 `.vsix` 安装包，装完即无用且 VS Code 永不清理。逐条列出，可单独安全删除；仅重装对应扩展时会重新下载。
- **HTTP 缓存（Cache）**：Chromium 磁盘缓存（市场资源、图标、webview 网络资源）。按子条目逐项列出，被运行实例锁定的条目单独失败、不影响其余；空间在重启 VS Code 后真正释放。
- **会话日志（logs）**：每次启动生成一个带时间戳的目录，只增不减。纯日志；当前正在写入的会话不会出现在列表中。

所有删除都进入系统**回收站 / 废纸篓**（`useTrash: true`），可恢复，绝不做永久删除。

## 安装

- 从 VS Code 扩展市场搜索 **VS Code Cleaner** 安装（发布后）；或本地打包安装：
  ```bash
  npm install
  npm run compile
  npm run webview:build   # 打包报告 webview 到 media/
  npx @vscode/vsce package   # 生成 .vsix，在 VS Code 中「从 VSIX 安装」
  ```

## 使用

1. 打开命令面板（Ctrl/Cmd+Shift+P），运行 **`VS Code Cleaner: Scan and Clean`**。
2. 报告页按类型分七个区域，支持：
   - 列排序（名称 / 类型 / 大小 / 修改时间）
   - 列宽拖拽
   - 关键词筛选（按名称或路径，命中行显示且对应区域自动展开；搜索不会替你改变勾选）
   - 区域折叠（点击标题收起/展开）
   - 中英界面切换（右上角下拉）
   - 点击行内任意位置即可勾选/取消（点击路径单元格则是复制完整路径）
3. 勾选要清理的项 → **Delete selected** → 确认 → 移至回收站，并显示释放空间。

## 设置

- `vscode-cleaner.minSizeMB`（默认 `0`）：可清理总量低于该值（MB）时只提示、不打开详细报告；`0` 表示始终打开报告。

## 安全约束

- 仅删除缓存/日志类数据：非激活的旧扩展版本、孤儿工作区缓存、ipch、CachedData、缓存安装包、HTTP 缓存与历史会话日志；不触碰活跃扩展、项目文件夹、运行中的扩展宿主。
- 删除走回收站，无永久删除兜底——误删可恢复。
- 路径按平台解析（`APPDATA` / `LOCALAPPDATA` / `XDG_CONFIG_HOME` / `XDG_CACHE_HOME`），兼容 `--user-data-dir`。

## 开发

```bash
npm install
npm run compile           # 类型检查并编译宿主到 out/
npm run watch             # 监听编译宿主
npm run webview:build     # 打包 webview（Vue 3 + Vite + Naive UI）到 media/
npm run webview:typecheck # webview 的 vue-tsc 类型检查
npm test                  # 运行单测（vitest）
```

调试：先 `npm run webview:build`，再 F5 选择 **Extension Development Host**，在新窗口运行命令即可。

## 许可

[MIT](./LICENSE)
