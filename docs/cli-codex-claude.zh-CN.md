# ChatPyMOL：CLI、MCP 与本地 Agent 协同接入

这套接入把聊天与三维编辑分开：

```text
Codex / Claude Code / Trae / WorkBuddy / 其他本地 Agent
                         │
                CLI + stdio MCP
                         │
                         ▼
                  版本化 Session API
                         │
                ┌────────┴────────┐
                ▼                 ▼
浏览器 PyMOL-WASM    落盘的 PDB/PML/版本历史
```

在任意已连接的本地 Agent 里说“把 A 链改成粉色”，MCP 会基于指定 Session 的最新版本创建新 PML 版本；已经打开的浏览器自动加载它。你随后在 PyMOL 原生面板中的人工操作也会自动保存成新版本，下一轮 CLI/AI 会重新读取，不需要再次上传。

通用接入只要求客户端支持本地 stdio MCP。Codex 与 Claude Code 另有仓库内适配器；Codex 还提供基于稳定 hooks 的会话自动绑定。Trae、WorkBuddy 等客户端的配置入口可能随版本变化，但只要能够注册本地 stdio MCP，就可以使用同一套工具契约。

本文对应 ChatPyMOL CLI、MCP 服务与本地 Agent 适配器 `0.2.0`。

## 1. 默认方式：本机私有运行

先在项目根目录安装 CLI，再用一个命令启动后台服务和浏览器：

```bash
npm ci --ignore-scripts
npm run build
npm install -g .
chatpymol local start --open --env-file "$PWD/.env"  # 已有 .env 时
```

本地服务默认只绑定 `127.0.0.1:8787`，不会监听局域网或公网，也不依赖 ChatPyMOL 云端。常用管理命令：

```bash
chatpymol local status
chatpymol local open
chatpymol local stop
```

`stop` 只停止经实例 ID 验证的 ChatPyMOL 进程，不删除数据。端口冲突时可运行 `chatpymol local start --port 8788`。Linux 默认目录为：

```text
数据：$XDG_DATA_HOME/chatpymol/data（默认 ~/.local/share/chatpymol/data）
状态、PID、日志：$XDG_STATE_HOME/chatpymol（默认 ~/.local/state/chatpymol）
CLI 配置：$XDG_CONFIG_HOME/chatpymol/config.json（默认 ~/.config/chatpymol/config.json）
模型配置：$XDG_CONFIG_HOME/chatpymol/.env（也可由 --env-file 指定）
```

macOS 使用 `~/Library/Application Support/ChatPyMOL`，Windows 使用 `%LOCALAPPDATA%\ChatPyMOL`。凭据文件权限设置为仅当前用户可读写。服务进程、数据、浏览器和 MCP 都在用户自己的机器上。源码开发模式仍可运行 `npm run dev`；手动前台生产模式仍可运行 `npm start`。

## 2. 可选：连接云端或实验室 LAN 服务

`pair/connect` 仍完整保留，供网页部署、团队服务器和 Claude Code 使用。它不是 Codex 插件的默认路径。目标服务启动后执行：

```bash
chatpymol pair --base-url https://你的-chatpymol-服务
```

根据终端给出的地址在浏览器完成一次配对。CLI 默认等待浏览器确认，然后把令牌保存到 `$XDG_CONFIG_HOME/chatpymol/config.json`；未设置 `XDG_CONFIG_HOME` 时保存到 `~/.config/chatpymol/config.json`。脚本模式可用 `--no-wait --json`，它会返回一次性的 `pollSecret`，调用方必须像令牌一样安全保存。令牌是访问该匿名工作区的凭据，不要提交到 Git、聊天截图或公开日志。

连接值优先级为：显式命令行参数 > 环境变量 > `pair` 保存的配置 > 默认值。重新配对前应清理旧 `CHATPYMOL_TOKEN`/`CHATPYMOL_BASE_URL`。开发时可直接运行 `node bin/chatpymol.mjs pair --base-url <地址>`。

## 3. CLI 使用

全局安装后可直接运行：

```bash
chatpymol status
chatpymol sessions
chatpymol open --session prj_...
chatpymol open --session prj_... --launch
```

`open` 默认只把浏览器深链打印到终端，便于 Codex/Claude 或远程 SSH 环境继续处理；只有显式添加 `--launch` 才会尝试启动本机浏览器。

CLI 还提供 `local start/stop/status/open` 与 `codex sessions/open`；其他命令包括 `pair`、`status`、`sessions`、`show`、`objects`、`create`、`select`、`apply`、`fetch`、`upload`、`version`、`open`、`export`、`exports` 与 `mcp`。用 `--help` 查看当前版本的精确参数：

```bash
chatpymol --help
chatpymol apply --help
```

开发环境中的等价入口是 `node bin/chatpymol.mjs <命令>`。

CLI 的 `upload` 使用 multipart，可上传不超过服务器 `MAX_UPLOAD_MB` 的文件（默认 50 MB）；MCP 的 Base64 `upload_structure` 为避免把巨大文本塞进模型上下文，单文件限制为 5 MB。更大的结构应使用 CLI 或浏览器聊天框上传。

协同写入必须明确 Session、至少一个真实对象和基线版本。典型顺序是：

```text
sessions
→ status / 读取指定 Session
→ 确认 objectIds 与 baseVersionId
→ apply
→ open
```

版本冲突不是失败：说明浏览器或另一个 AI 刚刚保存了新版本。重新读取 Session，在新版本上重做最小修改，不要强制覆盖。

`apply` 的 `--object` 是必填且可重复参数，可传 1 个、2 个或任意多个真实对象，不要求恰好两个。不能省略它或用空列表表示整个场景。用户要求“全部”时，先运行 `objects`，再把返回的每个目标 ID 各传一次：

```bash
chatpymol objects --session prj_...
chatpymol apply --session prj_... --base-version v000017_... \
  --object str_first --object str_second --object str_third \
  --command "show cartoon, all" --summary "统一全部已载入对象的展示"
```

如果 Session 里还没有真实对象，先 `fetch` 或 `upload`，不要调用 `apply`。

### CLI-first：用本地 stdio 启动 MCP

`chatpymol mcp --local` 是平台无关入口：若后台未运行会自动启动本机私有服务，并读取受保护的本地凭据。概念配置如下，实际字段位置以客户端当前版本为准：

```json
{
  "mcpServers": {
    "chatpymol": {
      "command": "chatpymol",
      "args": ["mcp", "--local"],
      "env": { "CHATPYMOL_SOURCE": "你的-agent-名称" }
    }
  }
}
```

Trae、WorkBuddy 或其他支持本地 stdio MCP 的 Agent 可以使用其设置页或配置文件注册上述服务。没有平台级会话 hooks 时，Agent 应先调用 `list_sessions`/`create_session` 明确选择当前 Session，并在后续写入中持续使用同一个 `sessionId`。

已有专用适配器的客户端也可以使用各自命令注册：

Codex：

```bash
codex mcp add --env CHATPYMOL_SOURCE=codex chatpymol \
  -- chatpymol mcp --local
```

Claude Code 默认继续使用已经 `pair` 的目标；需要它也使用本机私有服务时追加 `--local`：

```bash
claude mcp add --transport stdio --env CHATPYMOL_SOURCE=claude chatpymol \
  -- chatpymol mcp --local
```

没有全局安装时，把命令部分换成绝对路径，例如 `-- node "$PWD/bin/chatpymol.mjs" mcp --local`。stdio 与远程 HTTP MCP 使用相同工具契约；对同一客户端选择一种即可，避免同时注册两个同名 `chatpymol`。

## 4. Codex 接入

项目内可发布插件包位于：

```text
integrations/codex/plugins/chatpymol
```

它已经包含 `.codex-plugin/plugin.json`、本地 MCP 配置、`hooks/hooks.json` 与 `$chatpymol-collaboration` 技能。项目内 marketplace 位于 `integrations/codex/marketplace.json`；本项目没有擅自写入个人 marketplace 或安装配置。

从项目根目录安装这个本地包：

```bash
codex plugin marketplace add "$PWD/integrations/codex"
codex plugin add chatpymol@chatpymol-local
```

安装后重启 Codex。首次使用 `/hooks` 审查并信任插件 hooks，再通过 `/mcp` 确认 `chatpymol` 已连接，然后直接使用 `$chatpymol-collaboration`。修改插件 hooks 后，它们的哈希会变化，需要重新审查。

插件内 MCP 默认执行 `chatpymol mcp --local`。`SessionStart` 使用官方稳定的 `session_id` 与 `cwd` 创建绑定，`/resume` 的同一 `session_id` 会复用原 ChatPyMOL Session；不同 Codex 主会话映射到不同 Session。同一 Session 可包含任意多个结构对象。

`UserPromptSubmit` 只在用户明确谈到蛋白、核酸、配体、PyMOL 等分子主题时记录脱敏主题摘要；普通代码对话不落盘。插件不会读取 `transcript_path`，也不会保存原始 Codex `session_id` 或完整工作目录。`PreToolUse` 在调用 `mcp__chatpymol__*` 前给缺少 `sessionId` 的工具参数注入当前绑定；显式指定的 Session 不会被覆盖。

```bash
chatpymol codex sessions
chatpymol codex open --binding <会话哈希前缀>
```

浏览器深链直接定位绑定 Session。结构一旦在浏览器、`fetch_pdb` 或 `upload_structure` 中载入，下一轮会重新读取同一份本地结构和最新 PML，无需重复上传。

如果明确要连接远程服务，可不使用插件的 `--local` MCP，改为单独注册远程 HTTP MCP：

```bash
export CHATPYMOL_TOKEN='配对后得到的令牌'
codex mcp add chatpymol \
  --url "${CHATPYMOL_BASE_URL:-http://127.0.0.1:8787}/mcp" \
  --bearer-token-env-var CHATPYMOL_TOKEN
```

再在 `~/.codex/config.toml` 对应的 `[mcp_servers.chatpymol]` 下补充：

```toml
http_headers = { "x-chatpymol-source" = "codex" }
default_tools_approval_mode = "writes"
```

远程 HTTP 直连的完整模板见 `integrations/codex/config.toml.example`。远程模式不会自动获得本地插件的会话绑定，应继续显式传 `sessionId`。Codex 的这个配置使用固定 `url`、`bearer_token_env_var` 与 `http_headers`，不沿用 Claude Code 的 `${VAR:-default}`/`headers` 结构。如暂未安装插件，可把技能目录链接到当前仓库的技能发现目录：

```bash
mkdir -p .agents/skills
ln -s "$PWD/integrations/codex/plugins/chatpymol/skills/chatpymol-collaboration" \
  .agents/skills/chatpymol-collaboration
```

重启 Codex 后，可以说：

```text
使用 $chatpymol-collaboration，在这个 Codex 会话绑定的本地工作区中载入
1AKI 与 1LYZ，对齐后用两种柔和颜色区分，然后打开浏览器。
```

## 5. Claude Code 接入

Claude Code 插件位于：

```text
integrations/claude/chatpymol
```

本地开发加载：

```bash
claude --plugin-dir ./integrations/claude/chatpymol
```

插件默认执行系统 `PATH` 中的 `chatpymol mcp`，读取已配对的本机配置，不把 token 放进 `.mcp.json`。需要改为远程 HTTP 直连时，参考 `integrations/claude/http.mcp.example.json`，并通过环境变量提供地址和 token。

进入 Claude Code 后，用 `/mcp` 检查 `chatpymol` 连接，再调用：

```text
/chatpymol:chatpymol-collaboration
```

示例请求：

```text
读取“论文主图”Session 的最新版，把配体显示为 sticks，
保留我刚才在浏览器里手动调过的相机，并打开结果。
```

修改插件文件后运行 `/reload-plugins`。

## 6. 多 Session 与多蛋白

### 同一 Session 中比较多个结构

同一个 Session 可以同时包含两个或更多蛋白、蛋白与核酸、或复合物与配体。AI 会先读取真实对象列表，再显式选择目标；不会要求整个工作区只能有两个对象。

```text
Session 标题: lysozyme-comparison
sessionId: prj_a1b2c3d4e5f60708
对象: 1AKI、1LYZ、water-site
操作: 仅以 1LYZ 为参考对齐 1AKI，保留 water-site，并分别着色
```

对应写入必须携带：

```text
sessionId=prj_a1b2c3d4e5f60708
targetObjectIds=[本轮涉及的所有真实 str_... ID；至少 1 个]
baseVersionId=刚刚读取的 activeVersionId
```

这里恰好比较两个结构只是示例。单对象着色、三个以上对象共同展示、蛋白与核酸/配体混合场景都使用同一字段，按实际目标展开 ID 即可。

### 两个课题并行

```text
Session A: paper-figure   → 独立对象、PML、版本链
Session B: mutant-screen  → 独立对象、PML、版本链
```

先基于 Session A 的最新版提交，再重新读取 Session B 后提交。两个 Session 不能共享 `baseVersionId`，也不能依赖模糊的“当前场景”。

## 7. 人工与 AI 如何接力

1. AI 读取指定 Session 的当前对象和版本。
2. AI 提交最小 PML 命令，服务器创建新版本。
3. 浏览器收到实时事件并重新渲染。
4. 用户在 PyMOL 原生 A/S/H/L/C 面板、命令行或鼠标中继续编辑。
5. 浏览器静默自动保存人工版本。
6. 下一轮 AI 重新读取最新版本，再继续修改。

如果用户点开历史版本，只是预览；从旧版本继续编辑时也应创建新的可追溯版本，不能改写历史。

## 8. 导出

对话端可调用 `get_export_links` 获取指定 Session 最新 PML 与完整项目 ZIP。浏览器黑色 PyMOL 工具条提供结构、PML、PSE 与 PNG 导出；历史 PML 可先用 `get_version` 读取。所有导出目标都必须带明确 `sessionId`。

CLI 可以直接完成带认证的下载，且默认不会覆盖同名文件：

```bash
chatpymol export --session prj_... --format pml --output ./scene.pml
chatpymol export --session prj_... --format zip --output ./workspace.zip
```

只有用户明确添加 `--force` 时才会覆盖已有文件。

## 9. 官方格式参考

- Codex 插件与 MCP：[OpenAI 插件打包](https://developers.openai.com/plugins/build/plugins)、[OpenAI MCP 服务](https://developers.openai.com/plugins/build/mcp-server)
- Claude Code 插件与 MCP：[Claude Code 插件](https://code.claude.com/docs/en/plugins)、[Claude Code MCP](https://code.claude.com/docs/en/mcp)
