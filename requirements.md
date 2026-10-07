# VS Code Cleaner — 需求文档

> 一个 VS Code 扩展，用于清理 VS Code 自身「不会主动清理」的占用空间：
> C/C++ 扩展的 IntelliSense 缓存（ipch）以及更新后残留的旧版扩展。

---

## 1. 背景与动机

VS Code 在以下两件事上**不会自动清理**，导致磁盘空间被长期占用：

1. **插件更新后旧版本不删除**
   - 扩展更新时，`~/.vscode/extensions/` 下新旧版本并存，旧目录长期残留。
   - 实测证据（Linux 机器）：同一扩展两个版本共存，例如：
     - `ms-vscode.powershell-2025.2.0`（旧）
     - `ms-vscode.powershell-2025.4.0`（新）

2. **C/C++ 扩展的 ipch 编译缓存不自动删除**
   - 微软 C/C++ 扩展（`ms-vscode.cpptools`，**仍在活跃维护，未被 Copilot 替代**）会为
     每个「工作区 + 配置」生成哈希目录，写入 IntelliSense 预编译头缓存。
   - 路径（按系统）：
     - Windows：`%LOCALAPPDATA%/Microsoft/vscode-cpptools/ipch`
     - Linux：`$XDG_CACHE_HOME/vscode-cpptools/`（未定义时 `~/.cache/vscode-cpptools/`）
     - macOS：`~/Library/Caches/vscode-cpptools/`
   - 官方仅提供一个**软性大小上限**（`C_Cpp.intelliSenseCacheSize`），按 LRU 近似淘汰，
     **与插件更新无关**，旧哈希目录不会主动删除。
   - 实测证据（Linux 机器）：`~/.cache/vscode-cpptools/ipch` 下 **192 个子目录、约 4.2GB** 堆积。
   - 该缓存可直接删除，下次打开对应工作区时由扩展自动重建（首次略慢）。

**用户诉求**：开发跨平台的 VS Code 扩展，在 Windows 与 Linux 上都能一键清理上述空间。

### 1.1 本机实测空间占用（Linux，2026-10-07）

对开发机实测各目录体积，验证「ipch 通常最大」的判断：

| 目录 | 路径（Linux） | 占用 |
|------|------|------|
| C/C++ ipch 缓存 | `~/.cache/vscode-cpptools/ipch` | **4.2 GB** |
| 扩展根 | `~/.vscode/extensions` | 1.9 GB |
| 工作区存储 | `~/.config/Code/User/workspaceStorage` | 227 MB |
| 扩展编译缓存 | `~/.config/Code/CachedData` | 81 MB |

体量顺序：`ipch ≫ 扩展 ≫ workspaceStorage > CachedData`。
注：`CachedData` / `workspaceStorage` **不在** `~/.vscode/` 下（该路径不存在），实际位于用户数据根（见 4.2 节）。

---

## 2. 竞品分析与差异化定位

### 2.1 现有同类产品

经调研（2026-10-07），VS Code 清理类工具大致三类：

1. **Marketplace 上架扩展：`Extension and Workspace Cleaner`**（`bellstudio.extension-workspace-cleaner`）
   - 链接：https://marketplace.visualstudio.com/items?itemName=bellstudio.extension-workspace-cleaner
   - 功能：扫描**旧版扩展目录**（跨 VS Code / Insiders / OSS / VSCodium，基于各 profile 的
     `extensions.json` 判定活跃版本）、扫描 **`workspaceStorage`** 孤儿缓存；图形化预览报告 +
     逐项勾选 + 二次确认；删除走**系统回收站/废纸篓**（比永久删除更保守）；跨平台。
   - **不覆盖 ipch 缓存**。
   - 运营数据（Marketplace API 实查）：版本 `0.1.0`，**最近更新 2026-06-28**，
     安装量 **51**、下载量 **139**、加权评分 4.45。发布至今约 3.5 个月且**未再更新**，属极新、极细分市场。

2. **离线脚本**（非 Marketplace 扩展）：
   - `sv222/Remove-VSCode-Old-Versions`（Python）：https://github.com/sv222/Remove-VSCode-Old-Versions
   - `joelvaneenwyk/vscode-cleanup`（GitHub）：https://github.com/joelvaneenwyk/vscode-cleanup
   - 逻辑与本项目一致，但仅脚本形态、分发弱、无 UI。

3. **ipch / C_Cpp IntelliSense 缓存**：**当前无任何 VS Code 扩展覆盖**，全网仅有手动删除的博客教程，属完全空白。

### 2.2 差异化结论

- **旧版扩展清理**已被成熟扩展（`Extension and Workspace Cleaner`）覆盖，且与脚本思路同质，
  属「红海」，若仅做此功能将与现有扩展正面重叠、缺乏存在价值。
- **ipch 缓存清理**是**蓝海**且对应实测 4.2 GB 痛点、无人涉足——**应作为本扩展的核心卖点**。
- **workspaceStorage / CachedData** 清理已被竞品覆盖，可「顺带提供」以形成一站式体验，
  但非差异化重点。

> 定位建议：以 **ipch 一键清理** 为首要价值主张，旧版扩展 + 工作区缓存清理作为「附带能力」
> 提升完整度，避免与现有扩展在单一功能上硬碰。

---

## 3. 目标

- 提供一个在命令面板中触发、带「预览 + 确认」的清理流程。
- 跨平台（Windows / Linux，macOS 可选）自动解析正确的缓存与扩展目录。
- 安全：绝不删除当前正在激活/运行的扩展版本。
- **差异化优先级**：以 ipch 清理为核心卖点，旧版扩展与工作区缓存作附带能力（依据见 §2.2）。

---

## 4. 功能范围（MVP）

### 4.1 必须支持
- **命令面板命令**（如 `VS Code Cleaner: 扫描并清理`）。
- **扫描并列出可清理项 + 占用大小**，至少包含：
  1. `vscode-cpptools/ipch` 目录（**核心卖点，通常最大**，竞品空白）。
  2. `~/.vscode/extensions/` 下的**旧版扩展**（排除当前激活版本，与现有竞品同源）。
- **预览 → 确认 → 删除 → 报告释放空间** 的两步交互，绝不静默删除。

> 注：第 2 项与现有竞品功能重叠，仅为附带能力；第 1 项 ipch 才是核心卖点（见 §2.2）。

### 4.2 建议纳入（与 MVP 同源，优先级次之）

> 注意：以下两者均位于 VS Code 的**用户数据根（User Data Root）**，而非 `~/.vscode/` 下。
> - 扩展根（Extensions Root）：`~/.vscode/extensions/`（旧版扩展清理目标，见 4.1）。
> - 用户数据根（User Data Root，含 `User/`、`CachedData`、`Cache` 等）：
>   - Linux：`$XDG_CONFIG_HOME/Code/`（未定义时 `~/.config/Code/`）
>   - Windows：`%APPDATA%\Code\`
>   - macOS：`~/Library/Application Support/Code/`
> - 该根目录可被 `--user-data-dir` 启动参数覆盖，实现时须按平台解析，不可硬编码。

- **`CachedData`**：位于用户数据根下（如 Linux `~/.config/Code/CachedData`、Windows `%APPDATA%\Code\CachedData`）。
  这是 VS Code **自身的 V8/Electron 代码缓存**（渲染进程、共享进程、扩展宿主等各一个条目，目录名为脚本路径的内部哈希），
  **并非按扩展划分，无法对应到某个具体扩展**。可整体安全清理（VS Code 下次启动自动重建，首次启动略慢）。
- **`User/workspaceStorage`**：位于用户数据根下（如 Linux `~/.config/Code/User/workspaceStorage`、
  Windows `%APPDATA%\Code\User\workspaceStorage`）。每个打开过的工作区生成一个哈希子目录，
  记录工作区级状态；原项目/`.code-workspace` 已删除的即孤儿缓存。仅删 VS Code 缓存状态，
  **绝不删项目文件夹本身**。
- 其他扩展的同类缓存（如各自在 `~/.cache` 下的目录，可做可配置白名单）。

### 4.3 可选增强
- 设置项：`C_Cpp.intelliSenseCacheSize` 建议值提示；缓存路径迁移建议
  （`C_Cpp.intelliSenseCachePath`）。
- 自动阈值模式：扫描到超过 N GB 才提示。

---

## 5. 非目标（Out of Scope）
- 不实现「卸载/禁用扩展」的完整管理 UI（只删文件系统上的旧版本目录）。
- 不修改 VS Code 运行中的扩展宿主逻辑。
- 不依赖 Copilot 或任何 AI 能力。
- 不与现有清理扩展（如 `Extension and Workspace Cleaner`）在单一功能上正面竞争；
  聚焦其未覆盖的 ipch 场景。

---

## 6. 关键设计约束与安全要求

1. **只删非激活版本**
   - 读取 `~/.vscode/extensions/extensions.json`（记录当前启用版本）定位每个扩展的
     激活版本号。
   - 仅对「同名扩展的其他旧版本目录」执行删除。
   - 注意：多 profile 场景下，活跃版本判定应参考各 `User/profiles/<id>/extensions.json`，
     与竞品做法对齐，避免误删被其他 profile 使用的版本。
2. **ipch 可放心整目录删除**；C/C++ 扩展会重建。删除前弹确认即可。
3. **Windows 文件锁**：当前激活/已加载扩展的文件可能被锁（尤其 Windows）。
   旧版通常未加载、不锁，可删；删除前仍可加「VS Code 已关闭时更稳妥」的提示。
4. **跨平台路径解析**：用 `os.homedir()` + 环境变量（`LOCALAPPDATA` / `XDG_CACHE_HOME` /
   `XDG_CONFIG_HOME` / `APPDATA`）按平台分支，不要硬编码绝对路径；
   需分别解析「扩展根」与「用户数据根」两个独立根目录。
5. **删除动作需用户显式确认**（预览列表 + 确认对话框），防止误删在用版本。
6. **删除安全策略**：优先移动到系统回收站/废纸篓（与竞品一致，降低误删风险），
   而非永久删除；若环境不支持 trash 则失败并提示，不静默强删。

---

## 7. 技术栈建议
- 语言：**TypeScript**（VS Code 扩展官方推荐）。
- 脚手架：`yo code` 的 `New Extension (TypeScript)` 模板，或手写 `package.json` + 命令入口。
- 能力：Node.js `fs/promises` 做扫描与删除；`vscode` API 做命令、树视图、信息/确认弹窗；
  删除优先用支持 trash 的方式（`vscode` 文件服务或 `trash` 类库）。
- 分发：先本地 `.vsix` 安装自测，**暂不要求上架 Marketplace**。

---

## 8. 里程碑（建议开发顺序）
1. 脚手架 + 命令入口，打印各平台解析到的路径（验证路径逻辑，含「扩展根」与「用户数据根」）。
2. 实现 ipch 目录扫描（大小计算）——**核心卖点，优先落地**。
3. 实现旧版扩展识别（读 `extensions.json` 比对版本，含多 profile）。
4. 预览列表 + 确认删除 + 释放空间报告。
5. 跨平台实测（Windows + Linux）。

---

## 9. 参考资料
- 微软 C/C++ 扩展官方 FAQ（ipch 说明、缓存大小/路径设置）：
  https://code.visualstudio.com/docs/cpp/faq-cpp
- vscode-cpptools 仓库（确认扩展仍维护）：https://github.com/microsoft/vscode-cpptools
- 现有第三方「清理旧版扩展」脚本参考：https://github.com/sv222/Remove-VSCode-Old-Versions
- 竞品扩展（Marketplace，覆盖旧版扩展 + workspaceStorage，未覆盖 ipch）：
  https://marketplace.visualstudio.com/items?itemName=bellstudio.extension-workspace-cleaner
- 竞品扩展第三方统计页：https://vscodeextensions.com/extensions/bellstudio-extension-workspace-cleaner
- 另一清理脚本参考：https://github.com/joelvaneenwyk/vscode-cleanup
