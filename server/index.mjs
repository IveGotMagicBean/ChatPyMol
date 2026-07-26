import dotenv from "dotenv";
import express from "express";
import multer from "multer";
import path from "node:path";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { FileStore } from "./lib/fs-store.mjs";
import { proposePmlEdit } from "./lib/ai-provider.mjs";
import { streamProjectZip } from "./lib/project-export.mjs";
import { PairingBroker, WorkspaceEventHub } from "./lib/event-hub.mjs";
import {
  LocalChatPymolService,
  normalizeSource
} from "./lib/chatpymol-service.mjs";
import { handleStatelessMcpRequest } from "./lib/mcp-server.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const explicitEnvFile = String(process.env.CHATPYMOL_ENV_FILE || "").trim();
const standardEnvFile = path.join(root, ".env");
const envFile = explicitEnvFile
  ? path.resolve(process.cwd(), explicitEnvFile)
  : existsSync(standardEnvFile)
    ? standardEnvFile
    : path.join(root, "百炼配置.env");
dotenv.config({ path: envFile, quiet: true });
const port = Number(process.env.PORT || 8787);
const host = process.env.HOST || "0.0.0.0";
const maxUploadMb = Number(process.env.MAX_UPLOAD_MB || 50);
const eventHub = new WorkspaceEventHub();
const store = new FileStore(process.env.DATA_DIR || path.join(root, "data"), {
  onWorkspaceUpdated: (token, event) => eventHub.publish(token, event)
});
await store.init();
const pairingBroker = new PairingBroker({
  validateToken: (token) => store.deviceId(token)
});

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: maxUploadMb * 1024 * 1024, files: 8 }
});
const app = express();
app.disable("x-powered-by");
app.use(express.json({ limit: "8mb" }));

const PROTEIN_RECOMMENDATIONS = [
  {
    pdbId: "1CRN",
    title: "Crambin 小型蛋白",
    description: "结构紧凑、加载快速，适合第一次体验 cartoon、sticks 与配色。",
    category: "入门"
  },
  {
    pdbId: "1UBQ",
    title: "泛素 Ubiquitin",
    description: "经典小型蛋白，适合观察二级结构、表面与残基选择。",
    category: "经典"
  },
  {
    pdbId: "4HHB",
    title: "人脱氧血红蛋白",
    description: "四聚体与血红素配体，适合链着色、配体口袋和多亚基展示。",
    category: "复合物"
  },
  {
    pdbId: "4INS",
    title: "胰岛素",
    description: "小型激素蛋白，适合二硫键、链间关系和论文级构图。",
    category: "经典"
  },
  {
    pdbId: "6M0J",
    title: "ACE2–Spike RBD 复合物",
    description: "适合展示蛋白–蛋白界面、接触残基和双色链对比。",
    category: "界面"
  },
  {
    pdbId: "1BNA",
    title: "B-DNA 双螺旋",
    description: "用于测试核酸 cartoon、棒状表示以及蛋白–核酸场景扩展。",
    category: "核酸"
  }
];
const OFFICIAL_EXAMPLE_SCHEMA = 2;
const OFFICIAL_EXAMPLE_PML_MARKER =
  `# @chatpymol official-example=${OFFICIAL_EXAMPLE_SCHEMA}`;

app.get("/api/health", (_request, response) => {
  response.json({
    ok: true,
    aiMode: process.env.DASHSCOPE_API_KEY ? "bailian" : process.env.OPENAI_API_KEY ? "openai" : "local",
    model: process.env.DASHSCOPE_API_KEY ? (process.env.BAILIAN_MODEL || "qwen3.7-max") : (process.env.OPENAI_MODEL || "gpt-5.6-terra"),
    renderer: "pymol-open-source-2.6-wasm"
  });
});

app.post(
  "/api/integrations/pair/start",
  asyncRoute(async (request, response) => {
    const pair = pairingBroker.start(publicBaseUrl(request));
    response.status(201).json(pair);
  })
);

app.post(
  "/api/integrations/pair/complete",
  asyncRoute(async (request, response) => {
    const deviceToken = request.body?.deviceToken;
    store.deviceId(deviceToken);
    await store.listProjects(deviceToken);
    response.json(pairingBroker.complete(request.body?.code, deviceToken));
  })
);

app.get(
  "/api/integrations/pair/status",
  asyncRoute(async (request, response) => {
    const pollSecret = request.get("x-chatpymol-pair-secret");
    response.json(pairingBroker.status(request.query?.code, pollSecret));
  })
);

app.get(
  "/api/events",
  asyncRoute(async (request, response) => {
    const deviceToken = deviceTokenFromRequest(request, { allowQuery: true });
    store.deviceId(deviceToken);
    await store.listProjects(deviceToken);
    eventHub.subscribe(deviceToken, response, {
      clientId: request.query?.clientId
    });
  })
);

app.post("/mcp", async (request, response) => {
  try {
    const token = bearerToken(request);
    store.deviceId(token);
    await store.listProjects(token);
    const service = new LocalChatPymolService({
      store,
      token,
      baseUrl: publicBaseUrl(request),
      source: normalizeSource(request.get("x-chatpymol-source"), "mcp"),
      clientId: request.get("x-chatpymol-client-id"),
      downloadRcsb
    });
    await handleStatelessMcpRequest(request, response, service);
  } catch (error) {
    console.error("ChatPyMOL MCP request failed:", error);
    if (!response.headersSent) {
      response.status(error.status || 500).json({
        jsonrpc: "2.0",
        error: {
          code: error.status === 401 ? -32001 : -32603,
          message: error.message || "ChatPyMOL MCP request failed"
        },
        id: request.body?.id ?? null
      });
    }
  }
});

app.get("/mcp", (_request, response) => {
  response.status(405).set("allow", "POST").json({
    jsonrpc: "2.0",
    error: { code: -32000, message: "Method not allowed; use POST." },
    id: null
  });
});

app.delete("/mcp", (_request, response) => {
  response.status(405).set("allow", "POST").json({
    jsonrpc: "2.0",
    error: { code: -32000, message: "Stateless MCP has no session to delete." },
    id: null
  });
});

app.post(
  "/api/bootstrap",
  asyncRoute(async (request, response) => {
    const token = request.body?.deviceToken;
    const initial = await store.bootstrap(token);
    let workspace = initial;
    let exampleInjected = false;
    const isFirstVisit =
      initial.device.projects?.length === 1 &&
      initial.device.createdAt === initial.device.lastSeenAt;

    if (isFirstVisit && !workspace.structures.length) {
      const buffer = await readFile(path.join(root, "server/examples/1AKI.pdb"));
      await store.addStructure(token, workspace.project.id, {
        originalname: "1AKI.pdb",
        buffer,
        size: buffer.length
      });
      if (/^(?:新对话|未命名分子场景|New chat)/.test(workspace.project.title)) {
        await store.renameProject(token, workspace.project.id, "示例对话");
      }
      workspace = await store.getWorkspace(token, workspace.project.id);
      exampleInjected = true;
    }

    let exampleState = inspectOfficialExample(workspace);

    if (
      (exampleState.hasOfficialExample || exampleState.hasLegacyExample) &&
      /^(?:溶菌酶示例\s*·\s*1AKI|1AKI 示例)$/.test(workspace.project.title)
    ) {
      await store.renameProject(token, workspace.project.id, "示例对话");
      workspace = await store.getWorkspace(token, workspace.project.id);
      exampleState = inspectOfficialExample(workspace);
    }

    if (exampleState.canInstall) {
      let installed = false;
      await store.withProjectLock(token, workspace.project.id, async () => {
        const lockedWorkspace = await store.getWorkspace(
          token,
          workspace.project.id
        );
        const lockedState = inspectOfficialExample(lockedWorkspace);
        if (!lockedState.canInstall) return;

        const chronologicalVersions = [...lockedWorkspace.versions].sort(
          (left, right) => left.revision - right.revision
        );
        const fullVersions = await Promise.all(
          chronologicalVersions.map((version) =>
            store.getVersion(token, lockedWorkspace.project.id, version.id)
          )
        );
        const loadVersion =
          fullVersions.find((version) =>
            version?.pml.includes(
              `# @chatpymol structure=${lockedState.structure.id}`
            )
          ) || lockedWorkspace.version;
        let styledVersion = lockedWorkspace.version;
        if (!lockedWorkspace.pml.includes(OFFICIAL_EXAMPLE_PML_MARKER)) {
          styledVersion = await store.saveVersion(
            token,
            lockedWorkspace.project.id,
            {
              pml: officialExamplePml(lockedWorkspace.pml),
              actor: "ai",
              source: "demo",
              summary: "示例：将 1AKI 改为粉红色",
              baseVersionId: lockedWorkspace.project.activeVersionId,
              eventKind: "demo.scene.commit",
              objectIds: [lockedState.structure.id],
              _lockHeld: true
            }
          );
        }
        await store.replaceMessages(
          token,
          lockedWorkspace.project.id,
          officialExampleMessages({
            structure: lockedState.structure,
            loadVersionId: loadVersion.id,
            styledVersionId: styledVersion.id
          }),
          { _lockHeld: true }
        );
        await store.notifyWorkspaceUpdated(token, {
          type: "workspace.updated",
          action: "onboarding.example.installed",
          projectId: lockedWorkspace.project.id,
          sessionId: lockedWorkspace.project.id,
          conversationId: lockedWorkspace.project.id,
          versionId: styledVersion.id,
          revision: styledVersion.revision,
          objectIds: [lockedState.structure.id],
          source: "demo",
          actor: "system",
          updatedAt: new Date().toISOString()
        });
        installed = true;
      });
      workspace = await store.getWorkspace(token, workspace.project.id);
      exampleInjected ||= installed;
    }

    response.json({
      device: initial.device,
      ...workspace,
      exampleInjected
    });
  })
);

app.use("/api", (request, _response, next) => {
  request.deviceToken = deviceTokenFromRequest(request);
  store.deviceId(request.deviceToken);
  next();
});
app.get("/api/recommendations", (_request, response) => {
  response.json({ recommendations: PROTEIN_RECOMMENDATIONS });
});


app.get(
  "/api/projects/:projectId/versions/:versionId",
  asyncRoute(async (request, response) => {
    const version = await store.getVersion(
      request.deviceToken,
      request.params.projectId,
      request.params.versionId
    );
    if (!version) {
      const error = new Error("版本不存在");
      error.status = 404;
      throw error;
    }
    response.json({ version });
  })
);

app.get(
  "/api/projects",
  asyncRoute(async (request, response) => {
    response.json(await store.listProjects(request.deviceToken));
  })
);

app.post(
  "/api/projects/:projectId/activate",
  asyncRoute(async (request, response) => {
    const workspace = await store.activateProject(
      request.deviceToken,
      request.params.projectId
    );
    await store.notifyWorkspaceUpdated(request.deviceToken, {
      type: "workspace.updated",
      action: "session.selected",
      projectId: workspace.project.id,
      sessionId: workspace.project.id,
      conversationId: workspace.project.id,
      versionId: workspace.version?.id || null,
      revision: workspace.version?.revision || null,
      objectIds: workspace.structures.map((item) => item.id),
      source: requestSource(request, "browser"),
      actor: "human",
      clientId: requestClientId(request),
      updatedAt: new Date().toISOString()
    });
    response.json(workspace);
  })
);

app.patch(
  "/api/projects/:projectId",
  asyncRoute(async (request, response) => {
    const projectId = request.params.projectId;
    if (request.body?.title !== undefined) {
      await store.renameProject(request.deviceToken, projectId, request.body.title);
    }
    if (request.body?.pinned !== undefined) {
      await store.setProjectPinned(
        request.deviceToken,
        projectId,
        request.body.pinned
      );
    }
    const workspace = await store.getWorkspace(request.deviceToken, projectId);
    await store.notifyWorkspaceUpdated(request.deviceToken, {
      type: "workspace.updated",
      action: "session.metadata.updated",
      projectId,
      sessionId: projectId,
      conversationId: projectId,
      versionId: workspace.version?.id || null,
      revision: workspace.version?.revision || null,
      objectIds: workspace.structures.map((item) => item.id),
      source: requestSource(request, "browser"),
      actor: "human",
      clientId: requestClientId(request),
      updatedAt: new Date().toISOString()
    });
    response.json({
      project: workspace.project,
      ...(await store.listProjects(request.deviceToken))
    });
  })
);

app.delete(
  "/api/projects/:projectId",
  asyncRoute(async (request, response) => {
    const deletedSessionId = request.params.projectId;
    const workspace = await store.deleteProject(
      request.deviceToken,
      deletedSessionId
    );
    await store.notifyWorkspaceUpdated(request.deviceToken, {
      type: "workspace.updated",
      action: "session.deleted",
      projectId: deletedSessionId,
      sessionId: deletedSessionId,
      conversationId: deletedSessionId,
      activeSessionId: workspace.project.id,
      versionId: workspace.version?.id || null,
      revision: workspace.version?.revision || null,
      objectIds: [],
      source: requestSource(request, "browser"),
      actor: "human",
      clientId: requestClientId(request),
      updatedAt: new Date().toISOString()
    });
    response.json({
      workspace
    });
  })
);

app.post(
  "/api/projects",
  asyncRoute(async (request, response) => {
    const workspace = await store.createProject(
      request.deviceToken,
      request.body?.title
    );
    await store.notifyWorkspaceUpdated(request.deviceToken, {
      type: "workspace.updated",
      action: "session.created",
      projectId: workspace.project.id,
      sessionId: workspace.project.id,
      conversationId: workspace.project.id,
      versionId: workspace.version?.id || null,
      revision: workspace.version?.revision || null,
      objectIds: [],
      source: requestSource(request, "browser"),
      actor: "human",
      clientId: requestClientId(request),
      updatedAt: new Date().toISOString()
    });
    response.status(201).json(workspace);
  })
);

app.get(
  "/api/projects/:projectId",
  asyncRoute(async (request, response) => {
    response.json(
      await store.getWorkspace(request.deviceToken, request.params.projectId)
    );
  })
);

app.post(
  "/api/projects/:projectId/pml",
  asyncRoute(async (request, response) => {
    const version = await store.saveVersion(
      request.deviceToken,
      request.params.projectId,
      {
        pml: request.body?.pml,
        actor: requestActor(request, "human"),
        source: requestSource(request, "editor"),
        summary: request.body?.summary || "Edited PML",
        baseVersionId: request.body?.baseVersionId,
        parentVersionId: request.body?.parentVersionId,
        clientId: requestClientId(request),
        objectIds: request.body?.targetObjectIds
      }
    );
    const workspace = await store.getWorkspace(
      request.deviceToken,
      request.params.projectId
    );
    let manualMessage = null;
    if (request.body?.publishToChat) {
      manualMessage = await store.appendMessage(
        request.deviceToken,
        request.params.projectId,
        {
          role: "user",
          content:
            String(request.body?.message || "").trim() ||
            `完成了一次手动场景编辑：${version.summary}`,
          mode: request.body?.messageMode || "manual-edit",
          versionId: version.id,
          derivedFromVersionId: version.parentId,
          structureIds: Array.isArray(request.body?.targetObjectIds)
            ? request.body.targetObjectIds
            : workspace.structures.map((item) => item.id),
          source: requestSource(request, "editor")
        }
      );
    }
    response.status(201).json({
      version,
      manualMessage,
      workspace: await store.getWorkspace(
        request.deviceToken,
        request.params.projectId
      )
    });
  })
);

app.post(
  "/api/projects/:projectId/restore",
  asyncRoute(async (request, response) => {
    const version = await store.restoreVersion(
      request.deviceToken,
      request.params.projectId,
      request.body?.versionId,
      request.body?.baseVersionId,
      requestClientId(request)
    );
    const message = await store.appendMessage(
      request.deviceToken,
      request.params.projectId,
      {
        role: "user",
        content: `${version.summary}，形成新版本 v${version.revision}。`,
        mode: "history-restore",
        versionId: version.id,
        derivedFromVersionId: request.body?.versionId
      }
    );
    response.status(201).json({
      version,
      message,
      workspace: await store.getWorkspace(
        request.deviceToken,
        request.params.projectId
      )
    });
  })
);

app.post(
  "/api/projects/:projectId/ai",
  asyncRoute(async (request, response) => {
    const projectId = request.params.projectId;
    const message = String(request.body?.message || "").trim();
    if (!message || message.length > 10_000) {
      const error = new Error("Message must be between 1 and 10,000 characters");
      error.status = 400;
      throw error;
    }
    const initialWorkspace = await store.getWorkspace(request.deviceToken, projectId);
    const shouldGenerateTitle =
      !initialWorkspace.messages.some((item) => item.role === "user") &&
      /^(?:新对话|未命名分子场景|New chat)/.test(initialWorkspace.project.title);
    if (request.body?.baseVersionId !== initialWorkspace.project.activeVersionId) {
      const error = new Error("Scene changed before the AI edit started");
      error.status = 409;
      error.currentVersionId = initialWorkspace.project.activeVersionId;
      throw error;
    }

    const explicitPdbId = pdbIdFromMessage(message);
    const recommendedPdbId = wantsRandomProtein(message)
      ? PROTEIN_RECOMMENDATIONS.find(
          (candidate) =>
            !initialWorkspace.structures.some((item) =>
              item.filename
                .toUpperCase()
                .startsWith(`${candidate.pdbId}.`)
            )
        )?.pdbId || "1AKI"
      : null;
    const requestedPdbId = explicitPdbId || recommendedPdbId;
    if (
      requestedPdbId &&
      !initialWorkspace.structures.some((item) =>
        item.filename.toUpperCase().startsWith(`${requestedPdbId}.`)
      )
    ) {
      const buffer = await downloadRcsb(requestedPdbId, "pdb");
      await store.addStructure(
        request.deviceToken,
        projectId,
        {
          originalname: `${requestedPdbId}.pdb`,
          buffer,
          size: buffer.length
        },
        {
          baseVersionId: initialWorkspace.project.activeVersionId,
          actor: "ai",
          source: "ai-structure-fetch",
          eventKind: "ai.structure.fetch",
          clientId: requestClientId(request)
        }
      );
    }

    const userMessage = await store.appendMessage(
      request.deviceToken,
      projectId,
      { role: "user", content: message, mode: "human" }
    );
    const workspace = await store.getWorkspace(request.deviceToken, projectId);
    try {
      const modelMessage = requestedPdbId
        ? `${message}\n\n系统已经真实下载并加载 ${requestedPdbId}；只能使用当前 workspace 中该 ID 对应的真实对象，禁止生成其他 PDB ID、load 命令或 # @chatpymol 结构管理行。`
        : message;
      const proposal = await proposePmlEdit({
        message: modelMessage,
        pml: workspace.pml,
        scene: workspace.scene,
        structures: workspace.structures,
        history: workspace.messages
      });
      if (requestedPdbId) {
        proposal.conversationTitle = `${requestedPdbId} 结构展示`;
        proposal.summary = `载入并展示 ${requestedPdbId}`;
        proposal.assistantMessage =
          `已加载真实结构 ${requestedPdbId}，并生成对应场景。右侧 PyMOL 会显示实际执行结果。`;
      }
      if (shouldGenerateTitle && proposal.conversationTitle) {
        await store.renameProject(
          request.deviceToken,
          projectId,
          proposal.conversationTitle.replace(/\s+/g, " ").slice(0, 28)
        );
      }
      let version = workspace.version;
      if (proposal.pml !== workspace.pml) {
        version = await store.saveVersion(
          request.deviceToken,
          projectId,
          {
            pml: proposal.pml,
            actor: "ai",
            source: proposal.mode,
            summary: proposal.summary,
            baseVersionId: workspace.project.activeVersionId,
            eventKind: "ai.scene.commit",
            clientId: requestClientId(request)
          }
        );
      }
      const assistantMessage = await store.appendMessage(
        request.deviceToken,
        projectId,
        {
          role: "assistant",
          content: proposal.assistantMessage,
          mode: proposal.mode,
          model: proposal.model || null,
          skills: proposal.skills || [],
          versionId: version?.id || null
        }
      );
      response.json({
        userMessage,
        assistantMessage,
        workspace: await store.getWorkspace(request.deviceToken, projectId)
      });
    } catch (error) {
      await store.appendMessage(request.deviceToken, projectId, {
        role: "assistant",
        content: `AI 修改失败：${error.message}`,
        mode: "error"
      });
      throw error;
    }
  })
);

app.post(
  "/api/projects/:projectId/structures",
  upload.array("files", 8),
  asyncRoute(async (request, response) => {
    if (!request.files?.length) {
      const error = new Error("No structure files uploaded");
      error.status = 400;
      throw error;
    }
    const added = [];
    let uploadBaseVersionId = request.body?.baseVersionId;
    for (const file of request.files) {
      const result = await store.addStructure(
        request.deviceToken,
        request.params.projectId,
        file,
        {
          baseVersionId: uploadBaseVersionId,
          actor: requestActor(request, "human"),
          source: requestSource(request, "upload"),
          clientId: requestClientId(request),
          eventKind: "structure.upload"
        }
      );
      added.push(result);
      if (uploadBaseVersionId !== undefined) {
        uploadBaseVersionId = result.version.id;
      }
    }
    const latest = added.at(-1);
    const message = await store.appendMessage(
      request.deviceToken,
      request.params.projectId,
      {
        role: requestActor(request, "human") === "ai" ? "assistant" : "user",
        content: `上传了 ${added.map((item) => item.structure.filename).join("、")}。`,
        mode: "structure-upload",
        source: requestSource(request, "upload"),
        versionId: latest.version.id,
        structureIds: added.map((item) => item.structure.id)
      }
    );
    response.status(201).json({
      added,
      message,
      workspace: await store.getWorkspace(
        request.deviceToken,
        request.params.projectId
      )
    });
  })
);

app.post(
  "/api/projects/:projectId/fetch-rcsb",
  asyncRoute(async (request, response) => {
    const pdbId = String(request.body?.pdbId || "")
      .trim()
      .toUpperCase();
    const format = request.body?.format === "cif" ? "cif" : "pdb";
    if (!/^[A-Z0-9]{4}$/.test(pdbId)) {
      const error = new Error("PDB ID 必须是 4 位字母或数字");
      error.status = 400;
      throw error;
    }
    const buffer = await downloadRcsb(pdbId, format);
    const added = await store.addStructure(
      request.deviceToken,
      request.params.projectId,
      {
        originalname: `${pdbId}.${format}`,
        buffer,
        size: buffer.length
      },
      {
        baseVersionId: request.body?.baseVersionId,
        actor: requestActor(request, "human"),
        source: requestSource(request, "rcsb-fetch"),
        summary: `从 RCSB 载入 ${pdbId}.${format}`,
        eventKind: "structure.fetch",
        clientId: requestClientId(request)
      }
    );
    await store.appendMessage(request.deviceToken, request.params.projectId, {
      role: requestActor(request, "human") === "ai" ? "assistant" : "user",
      content: `已从 RCSB 下载并载入 ${pdbId}.${format}。你可以继续让我修改表示方式、颜色、选择区域或与其他结构比对。`,
      mode: "system",
      source: requestSource(request, "rcsb-fetch"),
      versionId: added.version.id,
      structureIds: [added.structure.id]
    });
    response.status(201).json({
      added,
      workspace: await store.getWorkspace(
        request.deviceToken,
        request.params.projectId
      )
    });
  })
);

app.post(
  "/api/projects/:projectId/import-pml",
  upload.single("file"),
  asyncRoute(async (request, response) => {
    if (!request.file) {
      const error = new Error("No PML file uploaded");
      error.status = 400;
      throw error;
    }
    const pml = request.file.buffer.toString("utf8");
    const version = await store.saveVersion(
      request.deviceToken,
      request.params.projectId,
      {
        pml,
        actor: "human",
        source: "pml-import",
        summary: `导入 ${request.file.originalname}`,
        baseVersionId: request.body?.baseVersionId,
        clientId: requestClientId(request)
      }
    );
    const message = await store.appendMessage(
      request.deviceToken,
      request.params.projectId,
      {
        role: "user",
        content: `导入并应用了 PML 文件：${request.file.originalname}。`,
        mode: "pml-import",
        versionId: version.id
      }
    );
    response.status(201).json({
      version,
      message,
      workspace: await store.getWorkspace(
        request.deviceToken,
        request.params.projectId
      )
    });
  })
);

app.get(
  "/api/projects/:projectId/export.zip",
  asyncRoute(async (request, response) => {
    const workspace = await store.getWorkspace(
      request.deviceToken,
      request.params.projectId
    );
    await streamProjectZip({
      response,
      store,
      token: request.deviceToken,
      projectId: request.params.projectId,
      workspace,
      filename: safeDownloadName(workspace.project.title)
    });
  })
);

app.get(
  "/api/projects/:projectId/export.pml",
  asyncRoute(async (request, response) => {
    const workspace = await store.getWorkspace(
      request.deviceToken,
      request.params.projectId
    );
    response
      .type("application/x-pymol")
      .attachment(`${safeDownloadName(workspace.project.title)}.pml`)
      .send(workspace.pml);
  })
);

app.get(
  "/api/projects/:projectId/structures/:structureId/download",
  asyncRoute(async (request, response) => {
    const result = await store.structurePath(
      request.deviceToken,
      request.params.projectId,
      request.params.structureId
    );
    if (!result) {
      const error = new Error("Structure not found");
      error.status = 404;
      throw error;
    }
    response.download(result.path, result.structure.filename);
  })
);

if (process.env.NODE_ENV === "production") {
  app.use(express.static(path.join(root, "dist")));
  app.get("/{*splat}", (_request, response) =>
    response.sendFile(path.join(root, "dist", "index.html"))
  );
}

app.use((error, _request, response, _next) => {
  console.error(error);
  response.status(error.status || 500).json({
    error: error.message || "Internal server error",
    currentVersionId: error.currentVersionId
  });
});

app.listen(port, host, () => {
  console.log(`ChatPyMOL API listening on http://${host}:${port}`);
});

function asyncRoute(handler) {
  return (request, response, next) =>
    Promise.resolve(handler(request, response, next)).catch(next);
}

function deviceTokenFromRequest(request, { allowQuery = false } = {}) {
  const headerToken = request.get("x-device-token");
  const queryToken = allowQuery ? request.query?.deviceToken : null;
  return headerToken || bearerToken(request, false) || queryToken;
}

function bearerToken(request, required = true) {
  const authorization = String(request.get("authorization") || "");
  const match = authorization.match(/^Bearer\s+([^\s]+)$/i);
  if (match) return match[1];
  if (!required) return null;
  const error = new Error("缺少 Authorization: Bearer CHATPYMOL_TOKEN");
  error.status = 401;
  throw error;
}

function requestClientId(request) {
  const value = String(request.get("x-chatpymol-client-id") || "").trim();
  return /^[A-Za-z0-9_.:-]{1,160}$/.test(value) ? value : null;
}

function requestSource(request, fallback) {
  return normalizeSource(
    request.body?.source || request.get("x-chatpymol-source"),
    fallback
  );
}

function requestActor(request, fallback = "human") {
  const actor = String(request.body?.actor || "").trim().toLowerCase();
  return ["human", "ai", "system"].includes(actor) ? actor : fallback;
}

function publicBaseUrl(request) {
  const configured = String(
    process.env.CHATPYMOL_PUBLIC_URL || process.env.PUBLIC_BASE_URL || ""
  )
    .trim()
    .replace(/\/+$/, "");
  if (configured) return configured;
  const forwardedProtocol = String(request.get("x-forwarded-proto") || "")
    .split(",")[0]
    .trim();
  const protocol = forwardedProtocol || request.protocol || "http";
  return `${protocol}://${request.get("host")}`;
}

function safeDownloadName(title) {
  return (
    String(title || "chatpymol-scene")
      .replace(/[^\p{L}\p{N}._-]+/gu, "_")
      .slice(0, 100) || "chatpymol-scene"
  );
}

function officialExamplePml(pml) {
  return `${String(pml || "").trimEnd()}\n\n${OFFICIAL_EXAMPLE_PML_MARKER}\ncolor pink, all\n`;
}

function inspectOfficialExample(workspace) {
  const structure = workspace.structures.find(
    (item) => item.filename.toUpperCase() === "1AKI.PDB"
  );
  const hasOfficialExample = workspace.messages.some(
    (message) =>
      message.demoSchema === OFFICIAL_EXAMPLE_SCHEMA &&
      message.demoStep === "official-ready"
  );
  const hasLegacyExample = workspace.messages.some((message) =>
    String(message.demoStep || "").startsWith("example-")
  );
  const hasOnlyWelcomeMessage =
    workspace.messages.length === 1 &&
    workspace.messages[0].mode === "system" &&
    workspace.messages[0].content?.startsWith("欢迎来到 ChatPyMOL");
  const hasRecognizedTitle =
    !workspace.project.pinned &&
    /^(?:示例对话|溶菌酶示例\s*·\s*1AKI|1AKI 示例)$/.test(
      workspace.project.title
    );
  const isUnedited = Boolean(
    structure &&
      workspace.structures.length === 1 &&
      workspace.messages.every((message) =>
        ["system", "demo"].includes(message.mode)
      ) &&
      workspace.versions.every((version) =>
        ["bootstrap", "upload", "demo"].includes(version.source)
      )
  );
  return {
    structure,
    hasOfficialExample,
    hasLegacyExample,
    canInstall: Boolean(
      structure &&
        !hasOfficialExample &&
        isUnedited &&
        hasRecognizedTitle &&
        (hasLegacyExample || hasOnlyWelcomeMessage)
    )
  };
}

function officialExampleMessages({
  structure,
  loadVersionId,
  styledVersionId
}) {
  const shared = {
    mode: "demo",
    demoSchema: OFFICIAL_EXAMPLE_SCHEMA
  };
  return [
    {
      ...shared,
      role: "user",
      demoStep: "official-request",
      content: "加载一个真实的经典蛋白，先给我一个清晰的结构概览。",
      contentEn:
        "Load a real classic protein and start with a clear structural overview."
    },
    {
      ...shared,
      role: "assistant",
      demoStep: "official-loaded",
      content:
        "已载入鸡卵清溶菌酶 1AKI 的真实 PDB 结构，并创建初始场景。当前为白色背景、marine 配色的卡通视图，已自动居中。点击下方 1AKI.pdb 可在右侧打开原生 PyMOL。",
      contentEn:
        "The real PDB structure of hen egg-white lysozyme 1AKI is loaded in a centered cartoon view with a white background and marine coloring. Open 1AKI.pdb below to view it in native PyMOL.",
      versionId: loadVersionId,
      structureIds: [structure.id]
    },
    {
      ...shared,
      role: "user",
      demoStep: "official-style-request",
      content: "把当前结构改成粉红色，并保留修改前的版本。",
      contentEn:
        "Color the current structure pink and keep the previous version."
    },
    {
      ...shared,
      role: "assistant",
      demoStep: "official-styled",
      content:
        "已将结构改为粉红色并保存为新版本；修改前的场景仍然保留。点击版本卡即可回看这个节点。",
      contentEn:
        "The structure is now pink and saved as a new version. The previous scene remains available, and this state can be reopened from the version card.",
      versionId: styledVersionId
    },
    {
      ...shared,
      role: "user",
      demoStep: "official-workflow-request",
      content: "我想自己微调，并比较修改前后的效果，应该怎么做？",
      contentEn:
        "How can I refine it manually and compare the result with earlier versions?"
    },
    {
      ...shared,
      role: "assistant",
      demoStep: "official-ready",
      content:
        "可以直接使用右侧 PyMOL 原生 A / S / H / L / C 菜单、鼠标或底部命令栏继续编辑；人工修改会自动保存，下一轮 AI 会读取最新场景。需要比较时，可点击对话中的版本卡查看历史，并使用撤销、重做或“恢复为新版本”。右侧还可以导出当前 PDB、PML、PSE 和光线追踪 PNG。",
      contentEn:
        "Continue editing with native PyMOL A / S / H / L / C menus, mouse controls, or the command line. Manual changes are saved automatically and become the next AI context. Use version cards, undo, redo, or restore-as-new-version to compare history. The workspace can export the current PDB, PML, PSE, and ray-traced PNG."
    }
  ];
}

function pdbIdFromMessage(message) {
  const normalized = String(message).trim().toUpperCase();
  if (/^[A-Z0-9]{4}$/.test(normalized) && /\d/.test(normalized)) {
    return normalized;
  }
  if (!/(?:加载|下载|打开|导入|展示|显示|看看|查看|fetch|load|open|download)/i.test(message)) {
    return null;
  }
  const candidates = normalized.match(/\b[A-Z0-9]{4}\b/g) || [];
  return candidates.find((value) => /\d/.test(value)) || null;
}

function wantsRandomProtein(message) {
  return /(?:(?:随便|随机|任意|示例|例子|推荐).*(?:蛋白|结构)|(?:蛋白|结构).*(?:随便|随机|任意|示例|例子|推荐)|不知道看什么|try\s+(?:a|any)\s+protein|recommend\s+(?:a|any)\s+protein)/i.test(
    message
  );
}

async function downloadRcsb(pdbId, format) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 25_000);
  let remote;
  try {
    remote = await fetch(
      `https://files.rcsb.org/download/${encodeURIComponent(pdbId)}.${format}`,
      {
        signal: controller.signal,
        headers: { "user-agent": "ChatPyMOL/0.1" }
      }
    );
  } finally {
    clearTimeout(timeout);
  }
  if (!remote.ok) {
    const error = new Error(
      remote.status === 404
        ? `RCSB 中未找到 ${pdbId}`
        : `RCSB 下载失败：HTTP ${remote.status}`
    );
    error.status = remote.status === 404 ? 404 : 502;
    throw error;
  }
  return Buffer.from(await remote.arrayBuffer());
}
