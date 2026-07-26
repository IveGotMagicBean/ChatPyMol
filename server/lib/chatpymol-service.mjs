const MAX_COMMANDS = 500;
const MAX_COMMAND_TEXT = 500_000;
const MAX_STRUCTURE_BYTES = 50 * 1024 * 1024;
const MAX_MCP_STRUCTURE_BYTES = 5 * 1024 * 1024;

export class LocalChatPymolService {
  constructor({
    store,
    token,
    baseUrl,
    source = "mcp",
    clientId = null,
    downloadRcsb
  }) {
    this.store = store;
    this.token = token;
    this.baseUrl = trimBaseUrl(baseUrl);
    this.source = normalizeSource(source, "mcp");
    this.clientId = cleanClientId(clientId);
    this.downloadRcsb = downloadRcsb;
  }

  async getWorkspace() {
    const listing = await this.store.listProjects(this.token);
    const activeSession = listing.activeProjectId
      ? await this.store.getWorkspace(this.token, listing.activeProjectId)
      : null;
    return {
      workspaceId: this.store.deviceId(this.token),
      activeSessionId: listing.activeProjectId,
      sessions: listing.projects.map(sessionSummary),
      activeVersionId: activeSession?.version?.id || null,
      browserUrl: this.getBrowserLink(listing.activeProjectId).browserUrl
    };
  }

  async listSessions() {
    const listing = await this.store.listProjects(this.token);
    return {
      activeSessionId: listing.activeProjectId,
      sessions: listing.projects.map(sessionSummary)
    };
  }

  async getSession(sessionId, { historyLimit = 20, includeEvents = false } = {}) {
    requireSessionId(sessionId);
    const workspace = await this.store.getWorkspace(this.token, sessionId);
    const limit = clampInt(historyLimit, 0, 200, 20);
    return {
      session: {
        id: workspace.project.id,
        title: workspace.project.title,
        pinned: workspace.project.pinned,
        createdAt: workspace.project.createdAt,
        updatedAt: workspace.project.updatedAt,
        revision: workspace.project.revision,
        activeVersionId: workspace.project.activeVersionId
      },
      version: workspace.version,
      pml: workspace.pml,
      scene: workspace.scene,
      objects: workspace.structures.map(structureObject),
      versions: workspace.versions,
      messages: limit ? workspace.messages.slice(-limit) : [],
      ...(includeEvents ? { events: workspace.events.slice(-200) } : {}),
      browserUrl: this.getBrowserLink(sessionId).browserUrl
    };
  }

  async listObjects(sessionId) {
    requireSessionId(sessionId);
    const workspace = await this.store.getWorkspace(this.token, sessionId);
    return {
      sessionId,
      activeVersionId: workspace.version?.id || null,
      objects: workspace.structures.map(structureObject)
    };
  }

  async createSession(title = "新对话") {
    const workspace = await this.store.createProject(this.token, title);
    await this.store.notifyWorkspaceUpdated(this.token, {
      type: "workspace.updated",
      action: "session.created",
      projectId: workspace.project.id,
      sessionId: workspace.project.id,
      conversationId: workspace.project.id,
      versionId: workspace.version?.id || null,
      revision: workspace.version?.revision || null,
      objectIds: [],
      source: this.source,
      actor: actorForSource(this.source),
      clientId: this.clientId,
      updatedAt: new Date().toISOString()
    });
    return {
      session: sessionSummary(workspace.project),
      version: workspace.version,
      browserUrl: this.getBrowserLink(workspace.project.id).browserUrl
    };
  }

  async selectSession(sessionId) {
    requireSessionId(sessionId);
    const workspace = await this.store.activateProject(this.token, sessionId);
    await this.store.notifyWorkspaceUpdated(this.token, {
      type: "workspace.updated",
      action: "session.selected",
      projectId: sessionId,
      sessionId,
      conversationId: sessionId,
      versionId: workspace.version?.id || null,
      revision: workspace.version?.revision || null,
      objectIds: workspace.structures.map((item) => item.id),
      source: this.source,
      actor: actorForSource(this.source),
      clientId: this.clientId,
      updatedAt: new Date().toISOString()
    });
    return {
      selectedSessionId: sessionId,
      session: sessionSummary(workspace.project),
      version: workspace.version,
      browserUrl: this.getBrowserLink(sessionId).browserUrl
    };
  }

  async applyPml({
    sessionId,
    baseVersionId,
    targetObjectIds,
    commands,
    summary = "更新分子场景"
  }) {
    requireSessionId(sessionId);
    requireVersionId(baseVersionId);
    requireTargetObjectIds(targetObjectIds);
    const normalizedCommands = normalizeCommands(commands);
    const workspace = await this.store.getWorkspace(this.token, sessionId);
    const normalizedTargets = validateTargets(
      targetObjectIds,
      workspace.structures
    );
    assertBaseVersion(workspace, baseVersionId);
    const targetLabel = normalizedTargets.join(",");
    const nextPml = `${workspace.pml.trimEnd()}\n\n# @chatpymol ${this.source} target=${targetLabel}\n${normalizedCommands.join("\n")}\n`;
    const cleanSummary = cleanText(summary, 240, "更新分子场景");
    const actor = actorForSource(this.source);
    const version = await this.store.saveVersion(this.token, sessionId, {
      pml: nextPml,
      actor,
      source: this.source,
      summary: cleanSummary,
      baseVersionId,
      eventKind: "external.scene.commit",
      clientId: this.clientId,
      objectIds: normalizedTargets
    });
    const message = await this.store.appendMessage(this.token, sessionId, {
      role: actor === "ai" ? "assistant" : "user",
      content: `${sourceDisplayName(this.source)}：${cleanSummary}`,
      mode: "external-agent-edit",
      source: this.source,
      versionId: version.id,
      derivedFromVersionId: baseVersionId,
      structureIds: normalizedTargets
    });
    return {
      sessionId,
      previousVersionId: baseVersionId,
      version,
      targetObjectIds: normalizedTargets,
      commands: normalizedCommands,
      message,
      browserUrl: this.getBrowserLink(sessionId, version.id).browserUrl
    };
  }

  async fetchPdb({ sessionId, baseVersionId, pdbId, format = "pdb" }) {
    requireSessionId(sessionId);
    requireVersionId(baseVersionId);
    if (typeof this.downloadRcsb !== "function") {
      const error = new Error("当前服务没有配置 RCSB 下载器");
      error.status = 501;
      throw error;
    }
    const normalizedId = normalizePdbId(pdbId);
    const normalizedFormat = format === "cif" ? "cif" : "pdb";
    const before = await this.store.getWorkspace(this.token, sessionId);
    assertBaseVersion(before, baseVersionId);
    const buffer = await this.downloadRcsb(normalizedId, normalizedFormat);
    const added = await this.store.addStructure(
      this.token,
      sessionId,
      {
        originalname: `${normalizedId}.${normalizedFormat}`,
        buffer,
        size: buffer.length
      },
      {
        baseVersionId,
        actor: actorForSource(this.source),
        source: this.source,
        summary: `从 RCSB 载入 ${normalizedId}.${normalizedFormat}`,
        eventKind: "external.structure.fetch",
        clientId: this.clientId
      }
    );
    const message = await this.store.appendMessage(this.token, sessionId, {
      role: actorForSource(this.source) === "ai" ? "assistant" : "user",
      content: `${sourceDisplayName(this.source)} 已从 RCSB 载入 ${normalizedId}.${normalizedFormat}。`,
      mode: "external-structure-fetch",
      source: this.source,
      versionId: added.version.id,
      structureIds: [added.structure.id]
    });
    return {
      sessionId,
      structure: structureObject(added.structure),
      version: added.version,
      message,
      browserUrl: this.getBrowserLink(sessionId, added.version.id).browserUrl
    };
  }

  async uploadStructure({
    sessionId,
    baseVersionId,
    filename,
    contentBase64
  }) {
    requireSessionId(sessionId);
    requireVersionId(baseVersionId);
    const cleanFilename = cleanText(filename, 180, "structure.pdb");
    if (!/^[A-Za-z0-9+/]*={0,2}$/.test(String(contentBase64 || ""))) {
      const error = new Error("contentBase64 不是有效的 Base64 文本");
      error.status = 400;
      throw error;
    }
    const buffer = Buffer.from(String(contentBase64 || ""), "base64");
    if (!buffer.length || buffer.length > MAX_MCP_STRUCTURE_BYTES) {
      const error = new Error(
        "MCP Base64 结构文件必须大于 0 且不超过 5 MB；更大文件请使用 chatpymol upload 命令（multipart，最大 50 MB）"
      );
      error.status = 400;
      throw error;
    }
    const added = await this.store.addStructure(
      this.token,
      sessionId,
      { originalname: cleanFilename, buffer, size: buffer.length },
      {
        baseVersionId,
        actor: actorForSource(this.source),
        source: this.source,
        summary: `载入本地结构 ${cleanFilename}`,
        eventKind: "external.structure.upload",
        clientId: this.clientId
      }
    );
    const message = await this.store.appendMessage(this.token, sessionId, {
      role: actorForSource(this.source) === "ai" ? "assistant" : "user",
      content: `${sourceDisplayName(this.source)} 已载入本地结构 ${cleanFilename}。`,
      mode: "external-structure-upload",
      source: this.source,
      versionId: added.version.id,
      structureIds: [added.structure.id]
    });
    return {
      sessionId,
      structure: structureObject(added.structure),
      version: added.version,
      message,
      browserUrl: this.getBrowserLink(sessionId, added.version.id).browserUrl
    };
  }

  async getVersion(sessionId, versionId) {
    requireSessionId(sessionId);
    requireVersionId(versionId);
    const version = await this.store.getVersion(this.token, sessionId, versionId);
    if (!version) {
      const error = new Error("版本不存在");
      error.status = 404;
      throw error;
    }
    return { sessionId, version };
  }

  getBrowserLink(sessionId, versionId = null) {
    const url = new URL(this.baseUrl || "http://127.0.0.1:8787");
    if (sessionId) url.searchParams.set("session", sessionId);
    if (versionId) url.searchParams.set("version", versionId);
    return { sessionId: sessionId || null, versionId, browserUrl: url.toString() };
  }

  getExportLinks(sessionId) {
    requireSessionId(sessionId);
    const base = this.baseUrl || "http://127.0.0.1:8787";
    return {
      sessionId,
      pml: `${base}/api/projects/${encodeURIComponent(sessionId)}/export.pml`,
      projectZip: `${base}/api/projects/${encodeURIComponent(sessionId)}/export.zip`,
      authentication: "Authorization: Bearer CHATPYMOL_TOKEN 或 x-device-token"
    };
  }
}

export class RemoteChatPymolService {
  constructor({ baseUrl, token, source = "cli", clientId = null }) {
    this.baseUrl = trimBaseUrl(baseUrl || "http://127.0.0.1:8787");
    this.token = token;
    this.source = normalizeSource(source, "cli");
    this.clientId = cleanClientId(clientId) || `cli-${process.pid}`;
  }

  async getWorkspace() {
    const listing = await this.request("/api/projects");
    const active = listing.activeProjectId
      ? await this.request(`/api/projects/${encodeURIComponent(listing.activeProjectId)}`)
      : null;
    return {
      activeSessionId: listing.activeProjectId,
      sessions: listing.projects.map(sessionSummary),
      activeVersionId: active?.version?.id || null,
      browserUrl: this.getBrowserLink(listing.activeProjectId).browserUrl
    };
  }

  async listSessions() {
    const listing = await this.request("/api/projects");
    return {
      activeSessionId: listing.activeProjectId,
      sessions: listing.projects.map(sessionSummary)
    };
  }

  async getSession(sessionId, { historyLimit = 20, includeEvents = false } = {}) {
    requireSessionId(sessionId);
    const workspace = await this.request(`/api/projects/${encodeURIComponent(sessionId)}`);
    const limit = clampInt(historyLimit, 0, 200, 20);
    return {
      session: sessionSummary(workspace.project),
      version: workspace.version,
      pml: workspace.pml,
      scene: workspace.scene,
      objects: workspace.structures.map(structureObject),
      versions: workspace.versions,
      messages: limit ? workspace.messages.slice(-limit) : [],
      ...(includeEvents ? { events: workspace.events.slice(-200) } : {}),
      browserUrl: this.getBrowserLink(sessionId).browserUrl
    };
  }

  async listObjects(sessionId) {
    const session = await this.getSession(sessionId, { historyLimit: 0 });
    return {
      sessionId,
      activeVersionId: session.version?.id || null,
      objects: session.objects
    };
  }

  async createSession(title = "新对话") {
    const workspace = await this.request("/api/projects", {
      method: "POST",
      body: { title }
    });
    return {
      session: sessionSummary(workspace.project),
      version: workspace.version,
      browserUrl: this.getBrowserLink(workspace.project.id).browserUrl
    };
  }

  async selectSession(sessionId) {
    requireSessionId(sessionId);
    const workspace = await this.request(
      `/api/projects/${encodeURIComponent(sessionId)}/activate`,
      { method: "POST" }
    );
    return {
      selectedSessionId: sessionId,
      session: sessionSummary(workspace.project),
      version: workspace.version,
      browserUrl: this.getBrowserLink(sessionId).browserUrl
    };
  }

  async applyPml({ sessionId, baseVersionId, targetObjectIds, commands, summary }) {
    requireSessionId(sessionId);
    requireVersionId(baseVersionId);
    requireTargetObjectIds(targetObjectIds);
    const normalizedCommands = normalizeCommands(commands);
    const current = await this.getSession(sessionId, { historyLimit: 0 });
    const targets = validateTargets(targetObjectIds, current.objects);
    if (current.version?.id !== baseVersionId) {
      throw conflictError(current.version?.id);
    }
    const targetLabel = targets.join(",");
    const pml = `${current.pml.trimEnd()}\n\n# @chatpymol ${this.source} target=${targetLabel}\n${normalizedCommands.join("\n")}\n`;
    const cleanSummary = cleanText(summary, 240, "更新分子场景");
    const result = await this.request(
      `/api/projects/${encodeURIComponent(sessionId)}/pml`,
      {
        method: "POST",
        body: {
          pml,
          baseVersionId,
          summary: cleanSummary,
          source: this.source,
          actor: actorForSource(this.source),
          publishToChat: true,
          message: `${sourceDisplayName(this.source)}：${cleanSummary}`,
          messageMode: "external-agent-edit",
          targetObjectIds: targets
        }
      }
    );
    return {
      sessionId,
      previousVersionId: baseVersionId,
      version: result.version,
      targetObjectIds: targets,
      commands: normalizedCommands,
      message: result.manualMessage,
      browserUrl: this.getBrowserLink(sessionId, result.version.id).browserUrl
    };
  }

  async fetchPdb({ sessionId, baseVersionId, pdbId, format = "pdb" }) {
    requireSessionId(sessionId);
    requireVersionId(baseVersionId);
    const result = await this.request(
      `/api/projects/${encodeURIComponent(sessionId)}/fetch-rcsb`,
      {
        method: "POST",
        body: {
          pdbId: normalizePdbId(pdbId),
          format,
          baseVersionId,
          source: this.source,
          actor: actorForSource(this.source)
        }
      }
    );
    return {
      sessionId,
      structure: structureObject(result.added.structure),
      version: result.added.version,
      browserUrl: this.getBrowserLink(sessionId, result.added.version.id).browserUrl
    };
  }

  async uploadStructure({ sessionId, baseVersionId, filename, contentBase64 }) {
    requireSessionId(sessionId);
    requireVersionId(baseVersionId);
    const bytes = Buffer.from(String(contentBase64 || ""), "base64");
    if (!bytes.length || bytes.length > MAX_STRUCTURE_BYTES) {
      const error = new Error("结构文件必须大于 0 且不超过 50 MB");
      error.status = 400;
      throw error;
    }
    const form = new FormData();
    form.append("files", new Blob([bytes]), filename);
    form.append("baseVersionId", baseVersionId);
    form.append("source", this.source);
    form.append("actor", actorForSource(this.source));
    const result = await this.request(
      `/api/projects/${encodeURIComponent(sessionId)}/structures`,
      { method: "POST", form }
    );
    const added = result.added.at(-1);
    return {
      sessionId,
      structure: structureObject(added.structure),
      version: added.version,
      browserUrl: this.getBrowserLink(sessionId, added.version.id).browserUrl
    };
  }

  async getVersion(sessionId, versionId) {
    return this.request(
      `/api/projects/${encodeURIComponent(sessionId)}/versions/${encodeURIComponent(versionId)}`
    ).then((result) => ({ sessionId, version: result.version }));
  }

  getBrowserLink(sessionId, versionId = null) {
    const url = new URL(this.baseUrl);
    if (sessionId) url.searchParams.set("session", sessionId);
    if (versionId) url.searchParams.set("version", versionId);
    return { sessionId: sessionId || null, versionId, browserUrl: url.toString() };
  }

  getExportLinks(sessionId) {
    requireSessionId(sessionId);
    return {
      sessionId,
      pml: `${this.baseUrl}/api/projects/${encodeURIComponent(sessionId)}/export.pml`,
      projectZip: `${this.baseUrl}/api/projects/${encodeURIComponent(sessionId)}/export.zip`,
      authentication: "Authorization: Bearer CHATPYMOL_TOKEN 或 x-device-token"
    };
  }

  async downloadExport(sessionId, format = "pml") {
    requireSessionId(sessionId);
    if (!["pml", "zip"].includes(format)) {
      const error = new Error("导出格式只能是 pml 或 zip");
      error.status = 400;
      throw error;
    }
    const suffix = format === "zip" ? "export.zip" : "export.pml";
    const response = await fetch(
      `${this.baseUrl}/api/projects/${encodeURIComponent(sessionId)}/${suffix}`,
      {
        headers: {
          "x-device-token": this.token,
          "x-chatpymol-client-id": this.clientId,
          "x-chatpymol-source": this.source
        }
      }
    );
    if (!response.ok) {
      let details = {};
      try {
        details = await response.json();
      } catch {
        details = { error: `${response.status} ${response.statusText}` };
      }
      const error = new Error(details.error || "导出失败");
      error.status = response.status;
      error.currentVersionId = details.currentVersionId;
      throw error;
    }
    const disposition = response.headers.get("content-disposition") || "";
    const encoded = disposition.match(/filename\*=UTF-8''([^;]+)/i)?.[1];
    const plain = disposition.match(/filename="?([^";]+)"?/i)?.[1];
    return {
      bytes: Buffer.from(await response.arrayBuffer()),
      filename: encoded
        ? decodeURIComponent(encoded)
        : plain || `chatpymol-${sessionId}.${format}`,
      contentType: response.headers.get("content-type") || null
    };
  }

  async request(path, { method = "GET", body, form } = {}) {
    const headers = {
      "x-device-token": this.token,
      "x-chatpymol-client-id": this.clientId,
      "x-chatpymol-source": this.source
    };
    let payload;
    if (form) {
      payload = form;
    } else if (body !== undefined) {
      headers["content-type"] = "application/json";
      payload = JSON.stringify(body);
    }
    const response = await fetch(`${this.baseUrl}${path}`, {
      method,
      headers,
      body: payload
    });
    if (!response.ok) {
      let details = {};
      try {
        details = await response.json();
      } catch {
        details = { error: `${response.status} ${response.statusText}` };
      }
      const error = new Error(details.error || "ChatPyMOL 请求失败");
      error.status = response.status;
      error.currentVersionId = details.currentVersionId;
      throw error;
    }
    return response.json();
  }
}

function sessionSummary(project) {
  return {
    id: project.id,
    title: project.title,
    pinned: Boolean(project.pinned),
    revision: project.revision,
    structureCount: project.structureCount ?? project.structureIds?.length ?? 0,
    activeVersionId: project.activeVersionId || null,
    createdAt: project.createdAt,
    updatedAt: project.updatedAt,
    preview: project.preview || null
  };
}

function structureObject(structure) {
  return {
    id: structure.id,
    objectName: structure.objectName || structure.name,
    filename: structure.filename,
    format: structure.format,
    bytes: structure.bytes,
    sha256: structure.sha256,
    createdAt: structure.createdAt,
    metadata: structure.metadata || null
  };
}

function normalizeCommands(commands) {
  if (!Array.isArray(commands) || !commands.length || commands.length > MAX_COMMANDS) {
    const error = new Error(`commands 必须包含 1-${MAX_COMMANDS} 条 PyMOL 命令`);
    error.status = 400;
    throw error;
  }
  const normalized = commands.map((command) => String(command || "").trim());
  if (normalized.some((command) => !command)) {
    const error = new Error("commands 不能包含空命令");
    error.status = 400;
    throw error;
  }
  if (normalized.join("\n").length > MAX_COMMAND_TEXT) {
    const error = new Error("本次 PyMOL 命令总长度不能超过 500 KB");
    error.status = 400;
    throw error;
  }
  return normalized;
}

function validateTargets(targetObjectIds, structures) {
  requireTargetObjectIds(targetObjectIds);
  const normalized = [
    ...new Set(targetObjectIds.map((item) => String(item || "").trim()))
  ];
  if (normalized.some((id) => !id)) {
    const error = new Error("targetObjectIds 不能包含空对象 ID");
    error.status = 400;
    throw error;
  }
  const existing = new Set(structures.map((item) => item.id));
  const missing = normalized.filter((id) => !existing.has(id));
  if (missing.length) {
    const error = new Error(`目标对象不属于此 Session：${missing.join(", ")}`);
    error.status = 400;
    throw error;
  }
  return normalized;
}

function requireTargetObjectIds(targetObjectIds) {
  if (!Array.isArray(targetObjectIds) || targetObjectIds.length < 1) {
    const error = new Error(
      "apply_pml 必须显式提供至少 1 个真实 targetObjectIds；如需修改全部对象，请先 list_objects 并展开全部 ID"
    );
    error.status = 400;
    throw error;
  }
  if (targetObjectIds.length > 200) {
    const error = new Error("targetObjectIds 一次最多包含 200 个对象");
    error.status = 400;
    throw error;
  }
}

function assertBaseVersion(workspace, baseVersionId) {
  if (workspace.project.activeVersionId !== baseVersionId) {
    throw conflictError(workspace.project.activeVersionId);
  }
}

function conflictError(currentVersionId) {
  const error = new Error("场景已被网页或另一个 Agent 更新；请重新读取 Session 后再修改");
  error.status = 409;
  error.currentVersionId = currentVersionId || null;
  return error;
}

function requireSessionId(sessionId) {
  if (!/^prj_[A-Za-z0-9_-]{8,80}$/.test(String(sessionId || ""))) {
    const error = new Error("必须提供明确有效的 sessionId，禁止隐式写入当前会话");
    error.status = 400;
    throw error;
  }
}

function requireVersionId(versionId) {
  if (!/^v[0-9]{6}_[A-Za-z0-9_-]{4,80}$/.test(String(versionId || ""))) {
    const error = new Error("写操作必须提供明确有效的 baseVersionId");
    error.status = 400;
    throw error;
  }
}

function normalizePdbId(pdbId) {
  const value = String(pdbId || "").trim().toUpperCase();
  if (!/^[A-Z0-9]{4}$/.test(value)) {
    const error = new Error("PDB ID 必须是 4 位字母或数字");
    error.status = 400;
    throw error;
  }
  return value;
}

export function normalizeSource(value, fallback = "mcp") {
  const clean = String(value || "").trim().toLowerCase();
  const base = /^[a-z0-9_.-]{1,48}$/.test(clean) ? clean : fallback;
  if (base.endsWith("-mcp") || base === "cli") return base;
  if (["codex", "claude"].includes(base)) return `${base}-mcp`;
  return base;
}

function actorForSource(source) {
  return /(?:codex|claude|agent|mcp)/.test(source) ? "ai" : "human";
}

function sourceDisplayName(source) {
  if (source.startsWith("codex")) return "Codex";
  if (source.startsWith("claude")) return "Claude";
  if (source.startsWith("cli")) return "ChatPyMOL CLI";
  return "外部 AI";
}

function cleanClientId(value) {
  const clean = String(value || "").trim();
  return /^[A-Za-z0-9_.:-]{1,160}$/.test(clean) ? clean : null;
}

function cleanText(value, maxLength, fallback) {
  return String(value || fallback).trim().replace(/\s+/g, " ").slice(0, maxLength) || fallback;
}

function clampInt(value, minimum, maximum, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed)
    ? Math.max(minimum, Math.min(maximum, Math.trunc(parsed)))
    : fallback;
}

function trimBaseUrl(value) {
  return String(value || "").trim().replace(/\/+$/, "");
}
