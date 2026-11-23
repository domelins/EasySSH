# EasySSH

基于 Rust 与 Tauri 2 的 SSH 客户端，包含主机仪表盘、终端、SFTP 和命令片段，提供终端界面（TUI）与桌面界面（GUI）两种前端。

## 仓库结构

本仓库是一个 cargo workspace：

```
crates/easyssh-core   引擎：SSH、配置、指标等，与前端无关
crates/easyssh        TUI 应用，二进制名为 easy
crates/easyssh-gui    Tauri 2 桌面应用：Rust IPC 在 src/，前端（SvelteKit）在 ui/
```

workspace 的 `default-members` 只包含 `easyssh-core` 与 `easyssh`。在仓库根目录直接执行 `cargo build` / `cargo test` / `cargo clippy` 时不会编译 GUI，也不需要 Node 或 Tauri 工具链；如需单独处理某个 crate，可使用 `-p easyssh-core`、`-p easyssh` 或 `-p easyssh-gui`。

## 环境要求

| 工具 | 版本 | 用途 |
|------|------|------|
| Rust | stable，1.89 及以上 | 全部 |
| clippy、rustfmt | 随 Rust 工具链 | 检查 |
| Node.js | 22（CI 使用的版本） | 仅 GUI |
| Tauri CLI | v2 | 仅 GUI 打包与开发 |

Tauri CLI 可任选一种安装方式：`npm i -g @tauri-apps/cli@^2`（命令为 `tauri`）或 `cargo install tauri-cli`（命令为 `cargo tauri`）。

Linux 编译 GUI 还需要 WebKitGTK 与 GTK 开发包，例如 Debian/Ubuntu 上的 `libwebkit2gtk-4.1-dev` 和 `libgtk-3-dev`。

```bash
rustup component add clippy rustfmt
```

## 构建与运行

### TUI

在仓库根目录执行：

```bash
# 调试构建并运行
cargo run

# 指定配置文件 / 输出详细日志
cargo run -- --config ./my-config.toml
cargo run -- --verbose

# 发布构建，产物为 target/release/easy
cargo build --release
```

### GUI

先安装前端依赖：

```bash
cd crates/easyssh-gui/ui
npm ci
```

然后在 `crates/easyssh-gui` 目录执行：

```bash
# 开发模式：自动执行 ui 下的 npm run dev（http://localhost:5173），Rust 侧修改后自动重新编译
cargo tauri dev

# 打包：自动执行 ui 下的 npm run build（输出到 ui/build），产物位于 target/release/bundle
cargo tauri build

# 仅打包 Windows NSIS 安装程序，产物位于 target/release/bundle/nsis/
cargo tauri build --bundles nsis
```

如果通过 npm 安装了 Tauri CLI，请将上述命令中的 `cargo tauri` 替换为 `tauri`。`tauri.conf.json` 中配置的打包目标为 `dmg`、`appimage`、`deb`、`nsis`、`rpm`。

## 测试与检查

### Workspace 默认成员（core + TUI）

在仓库根目录执行：

```bash
cargo fmt --check
cargo clippy --all-targets -- -D warnings
cargo test
```

`cargo clippy` 与 `cargo test` 不加 `-p` 时只作用于默认成员 `easyssh-core` 和 `easyssh`。

### GUI

GUI crate 编译时会嵌入已构建的前端产物，因此运行 cargo 命令前需要先生成 `ui/build`：

```bash
cd crates/easyssh-gui/ui
npm ci
npm run check    # svelte-kit sync + svelte-check
npm test         # vitest 单元测试
npm run build    # 生成 ui/build
```

然后回到仓库根目录执行：

```bash
cargo clippy -p easyssh-gui --all-targets -- -D warnings
cargo test -p easyssh-gui
```

### 前端 e2e

e2e 使用 Playwright，在 `crates/easyssh-gui/ui` 中运行：

```bash
npx playwright test    # 等同于 npm run test:e2e
```

`playwright.config.ts` 会先执行 `npm run build`，再用 `npm run preview -- --port 4173 --strictPort` 启动预览服务，并对 `http://localhost:4173` 运行 `e2e/` 下的用例；若本地 4173 端口已有服务，则会直接复用（CI 环境除外）。测试使用 Chromium（Desktop Chrome 配置），并在页面中模拟 Tauri 接口，不需要启动桌面应用。

## 配置与数据

应用配置目录：

- Linux：`~/.config/easyssh/`
- macOS：`~/Library/Application Support/easyssh/`
- Windows：`%APPDATA%\easyssh\`

该目录包含 `config.toml`、`hosts.toml` 和 `snippets.toml`。实际使用的目录按以下优先级确定：环境变量 `EASYSSH_CONFIG_DIR` 指定的目录；其次是可执行文件旁的 `easyssh-data/`，但仅在其中已有 `hosts.toml` 时生效（该文件只会在默认目录无法写入、保存回退到这里时产生，因此重启后仍读取同一目录，这个目录也可以用作便携安装）；最后是上面的默认目录。

程序启动时会读取 `~/.ssh/config`（Windows 为 `%USERPROFILE%\.ssh\config`）中的主机，但不会写入该文件。

TUI 的命令行选项见 `doc/easy.1`（安装后可用 `man easy` 查看）。`config.toml` 可设置主题（`default`、`dracula`、`nord`、`gruvbox`）与按键映射。

## 许可

Apache-2.0，见 [LICENSE](LICENSE)。
