# ChatPyMOL

用自然语言和 PyMOL 原生界面共同编辑蛋白、核酸与配体，并保留可回溯的场景版本。

## 在线体验

打开 **[chatpymol.com](https://chatpymol.com)**，无需注册即可开始。左侧是对话历史，中间用自然语言描述修改，右侧实时显示 PyMOL 场景；每次修改都可以回看、撤销、继续编辑并导出结构文件、PML、PSE 或图片。

## 本地 Agent 版本

本地版本不需要把 API Key 配置给 ChatPyMOL，也不把私密对话上传到 ChatPyMOL。把下面这段 Prompt 复制给 Codex、Claude Code、Trae、WorkBuddy 或其他支持本地命令 / stdio MCP 的 Agent：

```text
请帮我在本机安装并连接 ChatPyMOL，让你当前的本地对话可以用自然语言驱动浏览器中的 PyMOL。

仓库：https://github.com/IveGotMagicBean/ChatPyMol

请按以下步骤操作：
1. 克隆或更新仓库，确认 Node.js >= 22。
2. 在仓库根目录执行 npm ci --ignore-scripts、npm run build、npm install -g .。
3. 执行 chatpymol local start --open，让服务只监听 127.0.0.1；不要改成 0.0.0.0，也不要要求我提供云端服务地址。
4. 在你当前 Agent 的本地 MCP 配置中注册：command 为 chatpymol，args 为 ["mcp", "--local"]。
5. 如果 Agent 支持会话 hooks，使用仓库中对应的本地适配器；否则通过 MCP 工具显式创建或选择一个 ChatPyMOL Session。
6. 打开浏览器工作区后，先调用 get_session 和 get_browser_link 验证连接。

完成后告诉我：本地服务地址、当前 ChatPyMOL Session，以及我可以直接说“载入 1UBQ 并把 Lys48 标成黄色”开始使用。后续所有结构修改都必须实际调用 ChatPyMOL MCP 工具提交，不要只生成命令说明；每个 Agent 会话要继续使用同一个 Session。
```

之后直接在原来的 Agent 对话中说：

```text
使用 ChatPyMOL，在当前本地工作区载入 1UBQ；打开浏览器，并把后续修改同步到 PyMOL。
```

本地 Agent 可以同时管理多个 Session；每个 Session 可以放多个蛋白、核酸和配体。结构文件、PML、版本和事件都保存在本机用户数据目录。ChatPyMOL 只负责本地可视化与版本协作，模型请求仍由你当前 Agent 使用的模型提供商处理。

## 从源码运行

```bash
git clone git@github.com:IveGotMagicBean/ChatPyMol.git
cd ChatPyMol
npm ci --ignore-scripts
npm run dev
```

开发页面：`http://localhost:5173`。生产模式运行 `npm run build && npm start`，页面默认在 `http://localhost:8787`。

## 说明

- ChatPyMOL 是独立的社区开源项目，不是 Schrödinger, LLC 的官方产品。
- 浏览器版基于 Open-Source PyMOL / PyMOL-WASM，适合交互式展示、编辑和导出；大型结构仍受浏览器内存限制。
- 问题和建议请提交 [GitHub Issue](https://github.com/IveGotMagicBean/ChatPyMol/issues)，或邮件联系 [542058929@qq.com](mailto:542058929@qq.com)。

## 许可证与安全

请勿把 API Key、浏览器设备令牌或私密结构数据提交到 Git。安全问题请先阅读 [SECURITY.md](SECURITY.md)。
