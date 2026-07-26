# ChatPyMOL：CLI、Codex 与 Claude Code 协同接入

这套接入把聊天与三维编辑分开：

```text
Codex / Claude Code / ChatPyMOL CLI
              │
              ▼
       版本化 Session API
              │
     ┌────────┴────────┐
     ▼                 ▼
浏览器 PyMOL-WASM    落盘的 PDB/PML/版本历史
```

在 Codex 或 Claude Code 里说“把 A 链改成粉色”，MCP 会基于指定 Session 的最新版本创建新 PML 版本；已经打开的浏览器自动加载它。你随后在 PyMOL 原生面板中的人工操作也会自动保存成新版本，下一轮 CLI/AI 会重新读取，不需要再次上传。

本文对应 ChatPyMOL CLI、MCP 服务与 Codex/Claude 插件 `0.2.0`。

## 1. 启动服务

在项目根目录执行：

```bash
npm ci --ignore-scripts
npm run build
npm start
```

默认地址是 `http://127.0.0.1:8787`。开发模式可用 `npm run dev`。

## 2. 浏览器匿名配对

Codex 和 Claude 插件默认通过系统 `PATH` 中的 `chatpymol mcp` 启动，因此先从项目根目录安装 CLI：

```bash
npm run build
npm install -g .
```

CLI 和 MCP 使用浏览器匿名工作区令牌，不需要账号登录。执行：

```bash
chatpymol pair --base-url http://127.0.0.1:8787
```

根据终端给出的地址在浏览器完成一次配对。CLI 默认等待浏览器确认，然后把令牌保存到 `$XDG_CONFIG_HOME/chatpymol/config.json`；未设置 `XDG_CONFIG_HOME` 时保存到 `~/.config/chatpymol/config.json`。脚本模式可用 `--no-wait --json`，它会返回一次性的 `pollSecret`，调用方必须像令牌一样安全保存。令牌是访问该匿名工作区的凭据，不要提交到 Git、聊天截图或公开日志。

连接值按以下优先级解析：显式命令行参数（例如 `--base-url`、`--token`、`--config`）> 对应环境变量 > `pair` 保存的配置 > 默认值。`CHATPYMOL_CONFIG` 可指定另一份配置文件；显式 `--config` 优先。环境变量不会被 `pair` 改写，因此重新配对到另一台服务器或另一个浏览器工作区前，先执行：

```bash
unset CHATPYMOL_TOKEN CHATPYMOL_BASE_URL
chatpymol pair --base-url http://127.0.0.1:8787
```

否则旧的环境变量仍会优先于刚配对保存的新 token/地址。需要在一次命令中临时覆盖时，直接传显式 flag。

开发时不想全局安装，也可以直接执行：

```bash
node bin/chatpymol.mjs pair --base-url http://127.0.0.1:8787
```

## 3. CLI 使用

全局安装后可直接运行：

```bash
chatpymol status
chatpymol sessions
chatpymol open --session prj_...
chatpymol open --session prj_... --launch
```

`open` 默认只把浏览器深链打印到终端，便于 Codex/Claude 或远程 SSH 环境继续处理；只有显式添加 `--launch` 才会尝试启动本机浏览器。

CLI 提供 `pair`、`status`、`sessions`、`show`、`objects`、`create`、`select`、`apply`、`fetch`、`upload`、`version`、`open`、`export`、`exports` 与 `mcp`。用 `--help` 查看当前版本的精确参数：

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

两个插件默认就是这个模式：客户端启动 `chatpymol mcp`，CLI 读取上一节 `pair` 保存的同一份凭据，不需要在插件 JSON 或 shell 中填写 token。如果不安装插件，只想手工注册 MCP，可运行：

Codex：

```bash
codex mcp add --env CHATPYMOL_SOURCE=codex chatpymol \
  -- chatpymol mcp
```

Claude Code：

```bash
claude mcp add --transport stdio --env CHATPYMOL_SOURCE=claude chatpymol \
  -- chatpymol mcp
```

没有全局安装时，把命令部分换成绝对路径，例如 `-- node "$PWD/bin/chatpymol.mjs" mcp`。stdio 与远程 HTTP MCP 都指向同一服务器数据和版本链；对同一客户端选择一种即可，避免同时注册两个同名 `chatpymol`。

## 4. Codex 接入

项目内可发布插件包位于：

```text
integrations/codex/plugins/chatpymol
```

它已经包含 `.codex-plugin/plugin.json`、MCP 配置与 `$chatpymol-collaboration` 技能。项目内 marketplace 位于 `integrations/codex/marketplace.json`；本项目没有擅自写入个人 marketplace 或安装配置。

从项目根目录安装这个本地包：

```bash
codex plugin marketplace add "$PWD/integrations/codex"
codex plugin add chatpymol@chatpymol-local
```

安装后重启 Codex，通过 `/mcp` 确认 `chatpymol` 已连接，再直接使用 `$chatpymol-collaboration`。

插件内 MCP 默认执行 `chatpymol mcp`，基础地址和匿名令牌来自本机配对配置。即使服务部署到另一台机器，也只需重新运行一次 `chatpymol pair --base-url <地址>`，不用改插件。

如果只想调试 MCP、不安装插件，也可以单独加入 Codex：

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

远程 HTTP 直连的完整模板见 `integrations/codex/config.toml.example`。Codex 的这个配置使用固定 `url`、`bearer_token_env_var` 与 `http_headers`，不沿用 Claude Code 的 `${VAR:-default}`/`headers` 结构。如暂未安装插件，可把技能目录链接到当前仓库的技能发现目录：

```bash
mkdir -p .agents/skills
ln -s "$PWD/integrations/codex/plugins/chatpymol/skills/chatpymol-collaboration" \
  .agents/skills/chatpymol-collaboration
```

重启 Codex 后，可以说：

```text
使用 $chatpymol-collaboration，列出我的 Session，打开“溶菌酶比较”，
把 1AKI 与 1LYZ 对齐并用两种柔和颜色区分，然后给我浏览器链接。
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
