import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import * as z from "zod/v4";

export function createChatPymolMcpServer(service) {
  const server = new McpServer({ name: "chatpymol", version: "0.2.0" });

  server.registerTool(
    "get_workspace",
    {
      title: "读取 ChatPyMOL 工作区",
      description:
        "读取当前设备工作区、Session 列表和 activeSessionId。写入前仍必须显式传 sessionId 与 baseVersionId。",
      annotations: { readOnlyHint: true, idempotentHint: true }
    },
    () => toolCall(() => service.getWorkspace())
  );

  server.registerTool(
    "list_sessions",
    {
      title: "列出分子会话",
      description:
        "列出此浏览器设备下所有独立 Session（网页对话）。一个 Session 可包含多个蛋白、核酸或配体对象。",
      annotations: { readOnlyHint: true, idempotentHint: true }
    },
    () => toolCall(() => service.listSessions())
  );

  server.registerTool(
    "get_session",
    {
      title: "读取分子会话场景",
      description:
        "按明确 sessionId 读取最新版 PML、activeVersionId、对象、版本和最近消息。任何修改前必须调用此工具获取新 baseVersionId。",
      inputSchema: {
        sessionId: sessionIdSchema,
        historyLimit: z.number().int().min(0).max(200).default(20),
        includeEvents: z.boolean().default(false)
      },
      annotations: { readOnlyHint: true, idempotentHint: true }
    },
    ({ sessionId, historyLimit, includeEvents }) =>
      toolCall(() => service.getSession(sessionId, { historyLimit, includeEvents }))
  );

  server.registerTool(
    "list_objects",
    {
      title: "列出会话内分子对象",
      description:
        "列出指定 Session 中全部结构对象及 objectName、结构 ID、链和配体元数据。多个对象可共同分析，不要求恰好两个。",
      inputSchema: { sessionId: sessionIdSchema },
      annotations: { readOnlyHint: true, idempotentHint: true }
    },
    ({ sessionId }) => toolCall(() => service.listObjects(sessionId))
  );

  server.registerTool(
    "create_session",
    {
      title: "新建分子会话",
      description:
        "新建独立 ChatPyMOL Session 并返回其初始版本。后续所有写操作都要显式使用返回的 sessionId。",
      inputSchema: {
        title: z.string().trim().min(1).max(120).default("新对话")
      },
      annotations: { destructiveHint: false, idempotentHint: false }
    },
    ({ title }) => toolCall(() => service.createSession(title))
  );

  server.registerTool(
    "select_session",
    {
      title: "在浏览器中选择会话",
      description:
        "把明确 sessionId 设为此设备的活动网页会话，并实时通知已打开的浏览器。不会修改该 Session 的 PML。",
      inputSchema: { sessionId: sessionIdSchema },
      annotations: { destructiveHint: false, idempotentHint: true }
    },
    ({ sessionId }) => toolCall(() => service.selectSession(sessionId))
  );

  server.registerTool(
    "apply_pml",
    {
      title: "提交 PyMOL 场景修改",
      description:
        "把原生 PyMOL 命令追加到指定 Session 的最新版 PML，生成可回溯新版本并实时推送浏览器。必须提供刚由 get_session 返回的 baseVersionId；若网页人工编辑已产生新版本，会返回 409 和 currentVersionId，禁止覆盖。targetObjectIds 必须显式包含至少 1 个真实对象，可包含任意多个；用户要求全部时先 list_objects 并展开全部 ID。",
      inputSchema: {
        sessionId: sessionIdSchema,
        baseVersionId: versionIdSchema,
        targetObjectIds: z
          .array(z.string().min(1).max(120))
          .min(1)
          .max(200)
          .describe("至少 1 个真实目标结构 ID；可传任意多个，不要求恰好两个"),
        commands: z
          .array(z.string().trim().min(1).max(100_000))
          .min(1)
          .max(500)
          .describe("按执行顺序排列的原生 PyMOL 命令"),
        summary: z.string().trim().min(1).max(240)
      },
      annotations: { destructiveHint: false, idempotentHint: false }
    },
    (input) => toolCall(() => service.applyPml(input))
  );

  server.registerTool(
    "fetch_pdb",
    {
      title: "从 RCSB 载入结构",
      description:
        "把一个真实 RCSB PDB/mmCIF 结构载入指定 Session，保留已有全部对象并生成新版本。必须显式提供 sessionId 与 baseVersionId。可多次调用以组成多蛋白/蛋白核酸场景。",
      inputSchema: {
        sessionId: sessionIdSchema,
        baseVersionId: versionIdSchema,
        pdbId: z.string().trim().regex(/^[A-Za-z0-9]{4}$/),
        format: z.enum(["pdb", "cif"]).default("pdb")
      },
      annotations: { destructiveHint: false, idempotentHint: false, openWorldHint: true }
    },
    (input) => toolCall(() => service.fetchPdb(input))
  );

  server.registerTool(
    "upload_structure",
    {
      title: "上传本地结构",
      description:
        "将 Base64 编码、解码后不超过 5 MB 的本地 PDB/mmCIF 添加到明确 Session；生成新版本并推送网页。写入必须携带 baseVersionId。更大结构请用 chatpymol upload CLI 的 multipart 上传（最大 50 MB）。",
      inputSchema: {
        sessionId: sessionIdSchema,
        baseVersionId: versionIdSchema,
        filename: z.string().trim().min(1).max(180),
        contentBase64: z.string().min(1).max(7_000_000)
      },
      annotations: { destructiveHint: false, idempotentHint: false }
    },
    (input) => toolCall(() => service.uploadStructure(input))
  );

  server.registerTool(
    "get_version",
    {
      title: "读取历史场景版本",
      description: "读取指定 Session 的一个不可变历史 PML 版本，用于回溯、比较和解释。",
      inputSchema: {
        sessionId: sessionIdSchema,
        versionId: versionIdSchema
      },
      annotations: { readOnlyHint: true, idempotentHint: true }
    },
    ({ sessionId, versionId }) =>
      toolCall(() => service.getVersion(sessionId, versionId))
  );

  server.registerTool(
    "get_browser_link",
    {
      title: "获取浏览器深链",
      description:
        "返回带明确 sessionId（可选 versionId）的 ChatPyMOL 浏览器链接。打开后直接定位该会话/版本。",
      inputSchema: {
        sessionId: sessionIdSchema,
        versionId: versionIdSchema.optional()
      },
      annotations: { readOnlyHint: true, idempotentHint: true }
    },
    ({ sessionId, versionId }) =>
      toolCall(() => service.getBrowserLink(sessionId, versionId))
  );

  server.registerTool(
    "get_export_links",
    {
      title: "获取 PML 与项目导出链接",
      description:
        "返回指定 Session 最新 PML 和完整项目 ZIP 的下载地址。下载请求需要同一 CHATPYMOL_TOKEN。",
      inputSchema: { sessionId: sessionIdSchema },
      annotations: { readOnlyHint: true, idempotentHint: true }
    },
    ({ sessionId }) => toolCall(() => service.getExportLinks(sessionId))
  );

  return server;
}

export async function handleStatelessMcpRequest(request, response, service) {
  const server = createChatPymolMcpServer(service);
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true
  });
  try {
    await server.connect(transport);
    await transport.handleRequest(request, response, request.body);
  } finally {
    response.on("close", () => {
      transport.close().catch(() => {});
      server.close().catch(() => {});
    });
  }
}

export async function runStdioMcpServer(service) {
  const server = createChatPymolMcpServer(service);
  const transport = new StdioServerTransport();
  await server.connect(transport);
  return server;
}

async function toolCall(callback) {
  try {
    const result = await callback();
    return {
      content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      structuredContent: result
    };
  } catch (error) {
    const details = {
      error: error?.message || "ChatPyMOL 工具调用失败",
      status: error?.status || 500,
      currentVersionId: error?.currentVersionId || null
    };
    return {
      isError: true,
      content: [{ type: "text", text: JSON.stringify(details, null, 2) }]
    };
  }
}

const sessionIdSchema = z
  .string()
  .regex(/^prj_[A-Za-z0-9_-]{8,80}$/)
  .describe("明确的 ChatPyMOL Session ID（即网页对话 projectId）");

const versionIdSchema = z
  .string()
  .regex(/^v[0-9]{6}_[A-Za-z0-9_-]{4,80}$/)
  .describe("不可变场景版本 ID；写操作中作为乐观锁 baseVersionId");
