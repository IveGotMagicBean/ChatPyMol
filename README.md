# ChatPyMOL

一个在浏览器里运行的 AI–人工协同分子可视化工作台。自然语言、PyMOL 原生界面、CLI、Codex 和 Claude Code 共同维护同一条可追溯的场景版本链。

## 复制给 Codex，一键接入

把下面整段 Prompt 复制到 Codex。它会安装 CLI、插件与 MCP，并在你的电脑上启动只监听 `127.0.0.1` 的私有 ChatPyMOL；不需要 ChatPyMOL 云服务或浏览器配对：

```text
请帮我安装并连接 ChatPyMOL 的 Codex 插件。

项目仓库：https://github.com/IveGotMagicBean/ChatPyMol

请先阅读仓库中的 docs/cli-codex-claude.zh-CN.md，然后按以下要求操作：
1. 在安全的本地目录克隆或更新仓库，并确认 Node.js 版本不低于 22；
2. 在仓库根目录运行 npm ci --ignore-scripts、npm run build 和 npm install -g .；
3. 若仓库根目录已有我填写的 .env，运行 chatpymol local start --open --env-file "$PWD/.env"；否则运行 chatpymol local start --open。确认服务只绑定 127.0.0.1，不要改成 0.0.0.0；
4. 在仓库根目录运行 codex plugin marketplace add "$PWD/integrations/codex" 和 codex plugin add chatpymol@chatpymol-local；不要修改外部个人 marketplace 文件；
5. 使用 codex plugin list 和 codex mcp list 验证安装结果；
6. 完成后提醒我重启 Codex，在新会话中用 /hooks 审查并信任 ChatPyMOL hooks，再用 /mcp 确认 chatpymol 已连接。

ChatPyMOL hooks 只能使用官方稳定的 session_id、turn_id、cwd 字段；禁止读取 transcript_path。一个 Codex 主会话绑定一个本地 ChatPyMOL Session，/resume 必须复用；普通对话不应同步，只有 ChatPyMOL 工具操作和我明确提出的分子请求主题摘要可以落盘。

不要修改任何蛋白场景，除非我随后明确提出修改要求。不要询问 ChatPyMOL 服务地址，默认使用本地私有模式。
```

完成后可以在新的 Codex 对话中说：

```text
使用 $chatpymol-collaboration，在这个 Codex 会话绑定的本地工作区中
载入 1UBQ，打开浏览器，并把后续修改实时同步到 PyMOL。
```

> [!IMPORTANT]
> ChatPyMOL 是独立的社区开源项目，并非 Schrödinger, LLC 的官方产品，与其不存在隶属或背书关系。项目内的浏览器渲染器基于 Open-Source PyMOL；PyMOL 是 Schrödinger, LLC 的商标。

当前版本：`0.2.0`。它适合本地使用和受控科研内测；面向陌生访客开放公网服务前，请先阅读[生产部署与安全清单](docs/deployment.zh-CN.md)。

## 它解决什么问题

传统的“LLM → PyMOL 命令”在命令执行后往往缺少可编辑状态。ChatPyMOL 把一次科研对话组织成一个独立 Session：

- 一个 Session 可以同时包含任意数量的蛋白、核酸或其他结构对象；
- 每次 AI 修改、CLI 修改和人工 PyMOL 编辑都会生成新版本；
- PDB/mmCIF 等原始结构保持独立，版本化 PML 负责场景表示、颜色、选择、相机与标注；
- 每个对话节点可以回看当时的分子场景，也可以从历史版本继续编辑；
- 不同 Session 的对象、消息和版本链彼此隔离；
- 后台 Session 的更新只显示提示，不会抢走浏览器当前视图；显式切换前会先保存人工编辑。

```text
自然语言 / Codex / Claude / CLI ─┐
PyMOL 原生界面与命令行 ─────────┼─> 事件记录 ─> 版本化 PML ─> PyMOL-WASM
上传或下载的结构文件 ────────────┘       │
                                        └─> 可回放历史与导出
```

## 已实现

- GPT/Claude 风格的简洁三栏界面，左右面板可调宽度和收起；
- 中文/英文与亮色/暗色切换；
- 浏览器内真实 PyMOL Open-Source 2.6 WASM 渲染；
- 固定可见的经典 PyMOL A / S / H / L / C 原生栏、鼠标交互和命令行；
- 人工操作静默自动保存，下一轮 AI 或 CLI 自动读取最新版本；
- PDB/mmCIF 等结构上传、RCSB PDB 自动下载，以及可删除的 1AKI 官方示例对话；
- 多 Session、多对象、乐观并发保护和 `409` 冲突阻断；
- 版本回看、撤销/重做、恢复为新提交；
- PML、原始结构、工作区 ZIP、PSE 和光线追踪 PNG 导出；
- 浏览器与 CLI/Codex/Claude Code 间的实时更新；
- 匿名浏览器配对，不要求账号登录；
- Codex 插件、Claude Code 插件、CLI 与 MCP 工具；
- `chatpymol local start/stop/status/open` 本机私有运行，以及基于稳定 Codex hooks 的会话自动绑定。

## 快速开始

要求 Node.js 22+，以及支持 WebAssembly 与 WebGL 的最新版 Chrome、Edge 或 Firefox。

```bash
git clone git@github.com:IveGotMagicBean/ChatPyMol.git
cd ChatPyMol
cp .env.example .env
npm ci --ignore-scripts
npm run dev
```

开发页面默认位于 `http://localhost:5173`，API 位于 `http://localhost:8787`。

生产模式：

```bash
npm run build
npm start
```

生产页面默认位于 `http://localhost:8787`。

## 配置模型

编辑本地 `.env`。密钥文件已被 Git 忽略，不要把真实 API Key 粘贴到 Issue、截图、PML 或对话导出中。

阿里云百炼：

```dotenv
DASHSCOPE_API_KEY=
BAILIAN_BASE_URL=https://dashscope.aliyuncs.com/compatible-mode/v1
BAILIAN_MODEL=qwen3.7-max
```

OpenAI 兼容配置：

```dotenv
OPENAI_API_KEY=
OPENAI_BASE_URL=https://api.openai.com/v1
OPENAI_MODEL=gpt-5.6-terra
```

百炼和 OpenAI 都未配置时，系统仍可运行，但只提供有限的本地规则模式。环境文件选择顺序为：

1. `CHATPYMOL_ENV_FILE` 指定的文件；
2. 项目根目录 `.env`；
3. 为旧版本兼容的 `百炼配置.env`。

## CLI、Codex 与 Claude Code

完整中文说明见 [CLI、Codex 与 Claude Code 协同指南](docs/cli-codex-claude.zh-CN.md)。

从源码安装 CLI：

```bash
npm run build
npm install -g .
chatpymol local start --open
```

本地模式默认只监听 `127.0.0.1:8787`。Linux 数据位于 `$XDG_DATA_HOME/chatpymol/data`（默认 `~/.local/share/chatpymol/data`），状态与日志位于 `$XDG_STATE_HOME/chatpymol`（默认 `~/.local/state/chatpymol`）；默认模型配置读取 `$XDG_CONFIG_HOME/chatpymol/.env`，也可用 `--env-file` 指向已有密钥文件。macOS 和 Windows 使用各自标准用户应用数据目录。常用流程：

```bash
chatpymol sessions
chatpymol objects --session <session-id>
chatpymol apply \
  --session <session-id> \
  --base-version <version-id> \
  --object <object-id> \
  --command "color pink, object_name"
chatpymol open --session <session-id> --launch
```

Codex 插件默认运行 `chatpymol mcp --local`。稳定 hooks 会按 Codex `session_id` 自动创建/复用一个 ChatPyMOL Session，`/resume` 不会另开；不同 Codex 主会话相互隔离，同一会话可以包含任意多个蛋白、核酸与配体。`chatpymol codex sessions` 可查看脱敏后的绑定，`chatpymol codex open --binding <哈希前缀>` 可打开对应工作区。

连接已经部署的云端或实验室 LAN 服务仍然支持：运行 `chatpymol pair --base-url <地址>`，再使用不带 `--local` 的 `chatpymol mcp`；远程 HTTP MCP 配置见完整中文指南。

`apply` 必须明确至少一个对象 ID，但对象数量没有上限。若要修改整个场景，应先列出对象，再显式传入所有目标 ID。

插件目录：

- Codex：`integrations/codex/plugins/chatpymol`
- Claude Code：`integrations/claude/chatpymol`

## 数据与版本

源码直接运行服务时默认数据目录为 `./data`；`chatpymol local` 使用上文的系统用户数据目录：

```text
data/devices/<device-token 的 SHA-256 派生 ID>/
├── device.json
└── projects/<session-id>/
    ├── project.json
    ├── structures.json
    ├── structures/
    ├── versions.json
    ├── versions/
    ├── events.jsonl
    └── messages.jsonl
```

所有结构、消息、事件和版本都落盘。当前存储实现面向单个 Node.js 进程；不要让多个服务副本同时读写同一个 `DATA_DIR`。升级或迁移前应备份整个数据目录。

匿名设备令牌是 bearer 凭据，不等于强身份认证。拿到令牌的人可以访问对应工作区。公开部署前必须配置 HTTPS、限流、磁盘与模型额度、备份策略，并修复部署清单中列出的实时连接令牌问题。

## 浏览器版限制

ChatPyMOL 使用的是基于 PyMOL 2.6 的开源 WASM 移植版，不等同于桌面 Incentive PyMOL 3：

- 不包含 Qt/Tk 桌面窗口、专有插件或需要启动外部进程的命令；
- 大型结构受浏览器内存、WebAssembly 和显卡能力限制；
- 部分 OpenGL、插件和操作系统集成功能不可用；
- 原生 A/S/H/L/C 菜单、常用选择与表示、命令行、PML、PSE 和 PNG 导出可在当前支持范围内使用。

## 验证

```bash
npm test
npm run build
npm pack --dry-run
```

GitHub Actions 会在每次 push 和 Pull Request 上执行测试与生产构建。

## 安全与贡献

- 安全问题：[SECURITY.md](SECURITY.md)
- 贡献指南：[CONTRIBUTING.md](CONTRIBUTING.md)
- 产品建议：[新建 Issue](https://github.com/IveGotMagicBean/ChatPyMol/issues/new?template=suggestion.yml)
- 联系邮箱：[542058929@qq.com](mailto:542058929@qq.com)

## 致谢

ChatPyMOL 建立在这些开源工作的基础上：

- [PyMOL-Wasm](https://github.com/yakomaxa/PyMOL-Wasm)：浏览器端 PyMOL 移植与构建；
- [Open-Source PyMOL](https://github.com/schrodinger/pymol-open-source)：分子可视化核心；
- [Pyodide](https://github.com/pyodide/pyodide)：浏览器中的 Python/WebAssembly 运行时；
- [NumPy](https://github.com/numpy/numpy)：随 Pyodide 使用的数值计算组件；
- [Patinae](https://github.com/zmactep/patinae)：保留的 WebGPU 兼容回退适配器；
- [Model Context Protocol](https://modelcontextprotocol.io/)：CLI 与智能体工具协议。

完整归属和许可证边界见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。感谢这些项目及其贡献者。

## 许可证

ChatPyMOL 原创代码以 [MIT License](LICENSE) 发布。第三方代码、WASM、wheel、字体和其他资产继续遵循各自许可证；MIT License 不会替代它们。
