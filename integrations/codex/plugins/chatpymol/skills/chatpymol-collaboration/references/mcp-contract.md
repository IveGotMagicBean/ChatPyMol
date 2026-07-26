# ChatPyMOL MCP 工具契约

## 连接

- 服务名：`chatpymol`
- 插件默认传输：stdio，执行 `chatpymol mcp`
- 默认来源：`CHATPYMOL_SOURCE=codex`
- CLI 凭据：由 `chatpymol pair` 保存到本机配置，插件 JSON 不保存 token
- 远程备选：`${CHATPYMOL_BASE_URL:-http://127.0.0.1:8787}/mcp`，使用 `Authorization: Bearer ${CHATPYMOL_TOKEN}` 与 `x-chatpymol-source: codex`

stdio CLI 的连接值按“显式 flag > 环境变量 > `pair` 保存的配置 > 默认值”解析。重新配对前先清理旧 `CHATPYMOL_TOKEN` 与 `CHATPYMOL_BASE_URL`；否则旧环境变量仍会覆盖刚保存的新配置。

`CHATPYMOL_TOKEN` 是浏览器匿名工作区配对后得到的访问凭据。不要把它写入仓库、插件、PML、消息摘要或最终回复。

## 工具

| 工具 | 用途 | 写操作关键字段 |
| --- | --- | --- |
| `get_workspace` | 读取工作区摘要与当前活动 Session | 只读；不能替代写入前的 `get_session` |
| `list_sessions` | 列出当前凭据可见的 Session | 只读 |
| `get_session` | 读取一个 Session、当前版本和状态 | 只读；传 `sessionId` |
| `list_objects` | 列出 Session 内真实结构对象 | 只读；传 `sessionId` |
| `create_session` | 新建独立课题空间 | 名称等参数以工具 schema 为准 |
| `select_session` | 设置 CLI/浏览器显式选中的 Session | 传 `sessionId` |
| `apply_pml` | 追加最小 PML 修改并创建版本 | `sessionId`、非空 `targetObjectIds[]`、`baseVersionId`、`commands[]`、`summary` |
| `fetch_pdb` | 从结构数据库下载并加入 Session | `sessionId`、`baseVersionId`、`pdbId`、`format` |
| `upload_structure` | 上传 PDB/mmCIF 等结构 | `sessionId`、`baseVersionId`、`filename`、`contentBase64` |
| `get_version` | 读取指定历史版本 | 传 `sessionId` 与版本 ID |
| `get_browser_link` | 获取该 Session 的浏览器深链接 | 传 `sessionId`；工具只返回链接，不保证替用户启动浏览器 |
| `get_export_links` | 获取该 Session 最新 PML 与项目 ZIP | 只读；传 `sessionId` |

调用时以 MCP `tools/list` 返回的实际 JSON Schema 为准，不臆造可选字段。

## `apply_pml` 范式

```json
{
  "sessionId": "prj_a1b2c3d4e5f60708",
  "targetObjectIds": ["str_1aki000000000001", "str_1lyz000000000002"],
  "baseVersionId": "v000017_ab12cd34",
  "commands": [
    "align 1AKI and polymer.protein, 1LYZ and polymer.protein",
    "color marine, 1AKI",
    "color salmon, 1LYZ"
  ],
  "summary": "比对 1AKI 与 1LYZ，并用蓝色和珊瑚色区分两个结构"
}
```

`targetObjectIds` 不能省略，也不能是空数组，必须包含至少 1 个由 `list_objects` 返回的真实 ID。它可包含任意多个对象，不要求恰好两个。命令中的 PyMOL selection 不能替代这个字段；如用户要求全部对象，先 `list_objects`，再显式传入当前全部 ID。Session 中没有对象时，先用 `fetch_pdb` 或 `upload_structure` 载入结构。

## 冲突处理

把 HTTP 409、`VERSION_CONFLICT` 或响应中的 stale base version 视为正常协作冲突：

1. 不重放旧请求。
2. 重新调用 `get_session` 与 `list_objects`。
3. 比较人工新版本与待执行意图。
4. 以新的 `baseVersionId` 重新生成最小命令；语义冲突时先询问用户。

## 多 Session 示例

同一 Session 多对象操作（以下恰好使用两个只是示例，不是限制）：

```text
list_sessions
→ 由标题“溶菌酶比较”选择 sessionId="prj_a1b2c3d4e5f60708"
→ get_session(sessionId="prj_a1b2c3d4e5f60708")
→ list_objects(sessionId="prj_a1b2c3d4e5f60708")
→ 确认本轮涉及的任意多个 str_... 对象，取得 activeVersionId=v000017_ab12cd34
→ apply_pml(sessionId, targetObjectIds=[所有目标对象的明确 str_... ID], baseVersionId=v000017_ab12cd34, ...)
→ get_browser_link(sessionId)
```

两个课题并行：

```text
get_session(sessionId="prj_paper000000000001") → 基于它的 activeVersionId 写入
重新 list_sessions
get_session(sessionId="prj_mutant00000000001") → 基于它自己的 activeVersionId 写入
```

两个 Session 的对象 ID、PML 和版本号不得交叉使用。
