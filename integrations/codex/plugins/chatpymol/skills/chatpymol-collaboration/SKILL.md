---
name: chatpymol-collaboration
description: 通过 ChatPyMOL MCP 在 Codex 对话与浏览器 PyMOL-WASM 之间协同维护版本化分子场景。用于用自然语言查看或修改 PDB、mmCIF、蛋白、核酸、配体与多结构场景，上传或下载结构、比对对象、调整表示与颜色、打开浏览器人工编辑、读取人工编辑后的最新版、回溯版本或导出结果；涉及多个 Session、多个结构对象、PML 修改或版本冲突时必须使用本技能。
---

# ChatPyMOL 协同编辑

把 Codex 作为自然语言与科研推理入口，把浏览器中的 PyMOL 作为实时三维预览和原生人工编辑器。默认运行 `127.0.0.1` 上的本机私有 ChatPyMOL 服务，结构、PML、版本、映射与日志都落在当前用户目录，不依赖 ChatPyMOL 云端。

官方稳定 hooks 会读取 `session_id`、`turn_id` 与 `cwd`：一个 Codex 主会话绑定一个 ChatPyMOL Session，`/resume` 使用相同 `session_id`，因此复用原工作区；不同 Codex 主会话各自隔离。同一 ChatPyMOL Session 内仍可加载任意多个蛋白、核酸或配体。不要读取 `transcript_path`；它不是稳定接口，也不应把整段私密对话同步到 ChatPyMOL。

需要确认参数或错误语义时，读取 [MCP 工具契约](references/mcp-contract.md)。

## 每轮固定流程

1. 优先使用 SessionStart/UserPromptSubmit hook 注入的“本 Codex 主会话已绑定 Session”上下文。第一次调用 `get_session` 时可省略 `sessionId`，PreToolUse hook 会在工具执行前注入绑定值；工具返回后保存明确 ID。不要用网页全局 active Session 猜测目标。
2. 只有用户明确要求跨课题或切换到其他 ChatPyMOL Session 时才调用 `list_sessions` 并请用户选择。显式提供的 `sessionId` 不会被 hook 覆盖。
3. 调用 `list_objects` 读取该 Session 的所有真实结构对象。一个 Session 可以包含任意数量的蛋白、核酸与配体。
4. 把本轮会受修改影响的真实结构 ID 写入 `targetObjectIds`。它必须显式包含至少 1 个 ID，可包含任意多个，不要求恰好两个；PyMOL selection 不能替代这个提交边界。用户说“全部”时也要把 `list_objects` 返回的当前全部真实 ID 逐个展开，禁止省略或传空数组。Session 尚无对象时先载入结构，不调用 `apply_pml`。
5. 在写入前立即调用 `get_session`，记录返回的最新 `activeVersionId`，并在写工具中把它作为 `baseVersionId`。浏览器人工编辑可能刚刚产生了新版本，不能复用上一轮缓存。
6. 生成实现意图所需的最少 PyMOL 命令。保留原始结构对象；优先改表示、颜色、选择、相机、标签和测量，不做无关重排。
7. 调用 `apply_pml`，始终携带 `sessionId`、`targetObjectIds`、`baseVersionId`、`commands` 与中文 `summary`。
8. 检查返回的 Session 与新版本号。需要视觉检查或人工继续编辑时调用 `get_browser_link`，把链接交给用户或按用户要求打开。
9. 下一轮从步骤 1 重新读取。人工编辑会自动保存为新版本，永远不要假设上一次 AI 写入仍是最新版。

只读问题可在读取 Session、对象或版本后直接回答，不调用写工具。

## Session 与对象边界

- Codex 主会话与 ChatPyMOL Session 的映射只保存哈希、工作目录名称与目标 Session ID，不保存原始 Codex `session_id`、完整 `cwd` 或 transcript。普通代码/科研对话不进入 ChatPyMOL；只有明确涉及分子的提示才写入主题摘要和哈希，实际 ChatPyMOL 工具修改照常形成版本事件。
- 不同 Session 是不同课题空间，不共享 scene、对象、PML 或版本链。
- 同一 Session 可以加载多个结构；不要新增“必须正好两个对象”之类的门槛。
- `apply_pml.targetObjectIds` 是版本提交的对象边界，必须非空；命令内的 `chain A`、`organic` 等 selection 只描述对象内部范围，不能替代真实结构 ID。
- 比对命令本身需要移动对象与参考对象时，从真实对象列表中明确这两个 selection；其余对象可以留在同一 Session 中共同分析。
- `create_session`、`select_session`、`fetch_pdb`、`upload_structure` 等写操作也必须传明确 `sessionId` 或返回后立即保存明确的 `sessionId`。
- `apply_pml`、`fetch_pdb` 与 `upload_structure` 都会改变场景，必须携带刚读取的 `baseVersionId`。
- 用户同时谈到两个课题时，分别读取两个 Session，逐个提交，绝不把一个 Session 的 `baseVersionId` 用到另一个 Session。

## 版本与冲突

- `baseVersionId` 是人工与 AI 协同的并发保护，不得省略、猜测或使用其他 Session 的版本号。
- 遇到 HTTP 409、`VERSION_CONFLICT` 或服务端返回了不同最新版时，停止当前写入，重新调用 `get_session` 和 `list_objects`。
- 在新版本上重新推导最小修改。若人工变更与用户本轮意图不兼容，先说明差异并询问，不覆盖。
- 撤销、恢复与历史版本都应产生可追溯的新版本；不要要求服务器直接改写旧提交。

## PyMOL 命令原则

- 使用浏览器 PyMOL-WASM 支持的原生 PML；桌面 Qt 窗口、外部进程和仅商业插件功能不可用。
- 使用稳定对象名或由 `objectIds` 对应的对象 selection，不凭显示标题猜对象。
- 多对象命令显式限定 selection，例如 `model object_name`、`chain A`、`polymer.protein`、`organic`。
- 修改应是可追加、可读的命令列表；不要把 PDB 坐标重新内联进 PML。
- `summary` 用一句中文描述对象、动作与目的，例如“将 1AKI 的 A 链设为浅蓝卡通并突出配体”。

## 协作完成标准

写入完成后告诉用户：

- 修改的是哪个 Session 和哪些对象；
- 从哪个版本提交到哪个新版本；
- 浏览器会自动同步，人工可继续用原生 PyMOL 面板编辑；
- 下一次对话会重新读取人工编辑后的最新版，无需用户再次上传。

用户要查看时调用 `get_browser_link`。本地服务与浏览器使用同一私有设备工作区，链接会直接定位本 Codex 会话绑定的 Session；结构一旦由浏览器、`fetch_pdb` 或 `upload_structure` 载入，后续轮次不要求用户重复上传。
