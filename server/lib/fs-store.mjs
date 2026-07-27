import {
  appendFile,
  copyFile,
  mkdir,
  readFile,
  rename,
  rm,
  writeFile
} from "node:fs/promises";
import { createHash, randomUUID } from "node:crypto";
import path from "node:path";

const DEFAULT_PML = `# ChatPyMOL scene
# Human edits and AI edits are versioned together.
bg_color white
set ray_opaque_background, off
hide everything
show cartoon
color marine
orient
`;

const STRUCTURE_EXTENSIONS = new Set([
  "pdb",
  "ent",
  "cif",
  "mmcif",
  "bcif",
  "mol2",
  "sdf",
  "mol",
  "xyz",
  "gro",
  "mrc",
  "ccp4",
  "xtc",
  "trr"
]);

export class FileStore {
  constructor(root, { onWorkspaceUpdated = null } = {}) {
    this.root = path.resolve(root);
    this.onWorkspaceUpdated = onWorkspaceUpdated;
    this.projectLocks = new Map();
    this.deviceLocks = new Map();
  }

  async init() {
    await mkdir(this.root, { recursive: true });
    await mkdir(path.join(this.root, "shares"), { recursive: true });
  }

  deviceId(token) {
    if (!/^[A-Za-z0-9_-]{20,160}$/.test(token ?? "")) {
      const error = new Error("Invalid device token");
      error.status = 401;
      throw error;
    }
    return createHash("sha256").update(token).digest("hex").slice(0, 32);
  }

  deviceDir(token) {
    return path.join(this.root, "devices", this.deviceId(token));
  }

  projectDir(token, projectId) {
    assertId(projectId, "project");
    return path.join(this.deviceDir(token), "projects", projectId);
  }

  async bootstrap(token, options = {}) {
    if (!options._deviceLockHeld) {
      return this.withDeviceLock(token, () =>
        this.bootstrap(token, { _deviceLockHeld: true })
      );
    }
    const deviceDir = this.deviceDir(token);
    const deviceFile = path.join(deviceDir, "device.json");
    const now = new Date().toISOString();
    let device = await readJson(deviceFile, null);

    if (!device) {
      const projectId = `prj_${randomUUID().replaceAll("-", "").slice(0, 16)}`;
      device = {
        id: this.deviceId(token),
        createdAt: now,
        lastSeenAt: now,
        activeProjectId: projectId,
        projects: [projectId]
      };
      await mkdir(deviceDir, { recursive: true });
      await this.createProjectFiles(token, projectId, "未命名分子场景");
    } else {
      device.lastSeenAt = now;
    }

    await writeJsonAtomic(deviceFile, device);
    const workspace = await this.getWorkspace(token, device.activeProjectId);
    return { device, ...workspace };
  }

  async listProjects(token) {
    const deviceFile = path.join(this.deviceDir(token), "device.json");
    const device = await readJson(deviceFile, null);
    if (!device) {
      const error = new Error("设备尚未初始化");
      error.status = 401;
      throw error;
    }
    const projects = await Promise.all(
      (device.projects || []).map(async (projectId) => {
        const dir = this.projectDir(token, projectId);
        const project = await readJson(path.join(dir, "project.json"), null);
        const messages = await readJsonLines(path.join(dir, "messages.jsonl"));
        const lastUserMessage = [...messages].reverse().find((item) => item.role === "user");
        return project ? {
          id: project.id,
          title: project.title,
          createdAt: project.createdAt,
          updatedAt: project.updatedAt,
          pinned: Boolean(project.pinned),
          revision: project.revision,
          activeVersionId: project.activeVersionId,
          structureCount: project.structureIds?.length || 0,
          share: publicShareMetadata(project.share),
          preview: lastUserMessage?.content?.slice(0, 80) || "尚未开始对话"
        } : null;
      })
    );
    return {
      activeProjectId: device.activeProjectId,
      projects: projects.filter(Boolean).sort((a, b) =>
        Number(b.pinned) - Number(a.pinned) ||
        b.updatedAt.localeCompare(a.updatedAt)
      )
    };
  }

  async activateProject(token, projectId, options = {}) {
    if (!options._deviceLockHeld) {
      return this.withDeviceLock(token, () =>
        this.activateProject(token, projectId, { _deviceLockHeld: true })
      );
    }
    assertId(projectId, "project");
    const deviceFile = path.join(this.deviceDir(token), "device.json");
    const device = await readJson(deviceFile, null);
    if (!device?.projects?.includes(projectId)) {
      const error = new Error("对话不存在");
      error.status = 404;
      throw error;
    }
    device.activeProjectId = projectId;
    device.lastSeenAt = new Date().toISOString();
    await writeJsonAtomic(deviceFile, device);
    return this.getWorkspace(token, projectId);
  }

  async renameProject(token, projectId, title) {
    const projectFile = path.join(this.projectDir(token, projectId), "project.json");
    const project = await readJson(projectFile, null);
    if (!project) {
      const error = new Error("对话不存在");
      error.status = 404;
      throw error;
    }
    project.title = cleanTitle(title);
    project.updatedAt = new Date().toISOString();
    await writeJsonAtomic(projectFile, project);
    return project;
  }

  async setProjectPinned(token, projectId, pinned) {
    const projectFile = path.join(this.projectDir(token, projectId), "project.json");
    const project = await readJson(projectFile, null);
    if (!project) {
      const error = new Error("对话不存在");
      error.status = 404;
      throw error;
    }
    project.pinned = Boolean(pinned);
    await writeJsonAtomic(projectFile, project);
    return project;
  }

  async deleteProject(token, projectId, options = {}) {
    if (!options._deviceLockHeld) {
      return this.withDeviceLock(token, () =>
        this.deleteProject(token, projectId, { _deviceLockHeld: true })
      );
    }
    assertId(projectId, "project");
    const deviceFile = path.join(this.deviceDir(token), "device.json");
    const device = await readJson(deviceFile, null);
    if (!device?.projects?.includes(projectId)) {
      const error = new Error("对话不存在");
      error.status = 404;
      throw error;
    }

    let remaining = device.projects.filter((id) => id !== projectId);
    if (!remaining.length) {
      const replacementId = `prj_${randomUUID().replaceAll("-", "").slice(0, 16)}`;
      await this.createProjectFiles(token, replacementId, "新对话");
      remaining = [replacementId];
    }
    device.projects = remaining;
    if (device.activeProjectId === projectId) {
      device.activeProjectId = remaining[0];
    }
    const now = new Date().toISOString();
    if (device.officialExample?.projectId === projectId) {
      device.officialExample = {
        ...device.officialExample,
        status: "deleted",
        projectId: null,
        deletedAt: now
      };
    }
    device.lastSeenAt = now;
    await writeJsonAtomic(deviceFile, device);
    const deletedProject = await readJson(
      path.join(this.projectDir(token, projectId), "project.json"),
      null
    );
    if (deletedProject?.share?.id) {
      await rm(this.shareDir(deletedProject.share.id), {
        recursive: true,
        force: true
      });
    }
    await rm(this.projectDir(token, projectId), { recursive: true, force: true });
    return this.getWorkspace(token, device.activeProjectId);
  }

  async createProject(
    token,
    title = "未命名分子场景",
    options = {}
  ) {
    if (!options._deviceLockHeld) {
      return this.withDeviceLock(token, () =>
        this.createProject(token, title, {
          ...options,
          _deviceLockHeld: true
        })
      );
    }
    const { activate = true, officialExampleSchema = null } = options;
    const deviceDir = this.deviceDir(token);
    const deviceFile = path.join(deviceDir, "device.json");
    const device = await readJson(deviceFile, null);
    if (!device) {
      const error = new Error("Device has not been bootstrapped");
      error.status = 401;
      throw error;
    }
    const projectId = `prj_${randomUUID().replaceAll("-", "").slice(0, 16)}`;
    await this.createProjectFiles(token, projectId, cleanTitle(title));
    device.projects.push(projectId);
    if (activate) device.activeProjectId = projectId;
    const now = new Date().toISOString();
    if (
      officialExampleSchema !== null &&
      Number.isFinite(Number(officialExampleSchema))
    ) {
      device.officialExample = {
        schema: Number(officialExampleSchema),
        status: "pending",
        projectId,
        installedAt: null,
        deletedAt: null
      };
    }
    device.lastSeenAt = now;
    await writeJsonAtomic(deviceFile, device);
    return this.getWorkspace(token, projectId);
  }

  async markOfficialExample(token, schema, projectId, options = {}) {
    if (!options._deviceLockHeld) {
      return this.withDeviceLock(token, () =>
        this.markOfficialExample(token, schema, projectId, {
          ...options,
          _deviceLockHeld: true
        })
      );
    }
    const status = options.status === "pending" ? "pending" : "installed";
    assertId(projectId, "project");
    const deviceFile = path.join(this.deviceDir(token), "device.json");
    const device = await readJson(deviceFile, null);
    if (!device?.projects?.includes(projectId)) {
      const error = new Error("示例对话不属于当前设备");
      error.status = 404;
      throw error;
    }
    const now = new Date().toISOString();
    device.officialExample = {
      schema: Number(schema),
      status,
      projectId,
      installedAt:
        status === "installed"
          ? device.officialExample?.installedAt || now
          : device.officialExample?.installedAt || null,
      deletedAt: null
    };
    await writeJsonAtomic(deviceFile, device);
    return device;
  }

  async createProjectFiles(token, projectId, title) {
    const dir = this.projectDir(token, projectId);
    const now = new Date().toISOString();
    await mkdir(path.join(dir, "versions"), { recursive: true });
    await mkdir(path.join(dir, "structures"), { recursive: true });
    const project = {
      id: projectId,
      title,
      pinned: false,
      createdAt: now,
      updatedAt: now,
      revision: 0,
      activeVersionId: null,
      structureIds: []
    };
    await writeJsonAtomic(path.join(dir, "project.json"), project);
    await writeJsonAtomic(path.join(dir, "structures.json"), []);
    await this.saveVersion(token, projectId, {
      pml: DEFAULT_PML,
      actor: "system",
      source: "bootstrap",
      summary: "创建初始场景",
      baseVersionId: null
    });
    await this.appendMessage(token, projectId, {
      role: "assistant",
      content:
        "欢迎来到 ChatPyMOL。你可以上传本地 PDB/mmCIF、输入 PDB ID 自动获取结构，或直接用自然语言开始。右侧支持完整的 PyMOL 原生交互；AI 与人工操作会共同保存为可回退的版本。",
      contentEn:
        "Welcome to ChatPyMOL. Upload a local PDB/mmCIF file, enter a PDB ID, or start with a natural-language request. The right workspace provides native PyMOL interaction, while AI and manual edits are saved together as reversible versions.",
      mode: "system"
    });
  }

  async getWorkspace(token, projectId) {
    const dir = this.projectDir(token, projectId);
    const project = await readJson(path.join(dir, "project.json"), null);
    if (!project) {
      const error = new Error("Project not found");
      error.status = 404;
      throw error;
    }
    const version = await this.getVersion(token, projectId, project.activeVersionId);
    const [structures, messages, events, versions] = await Promise.all([
      readJson(path.join(dir, "structures.json"), []),
      readJsonLines(path.join(dir, "messages.jsonl")),
      readJsonLines(path.join(dir, "events.jsonl")),
      this.listVersions(token, projectId)
    ]);
    let metadataChanged = false;
    for (const structure of structures) {
      if (structure.metadata) continue;
      try {
        const bytes = await readFile(
          path.join(dir, "structures", structure.storageName)
        );
        structure.metadata = summarizeStructureMetadata(
          bytes,
          structure.format
        );
        metadataChanged = true;
      } catch {
        structure.metadata = {
          schemaVersion: 1,
          available: false,
          reason: "结构文件暂时无法读取"
        };
      }
    }
    if (metadataChanged) {
      await writeJsonAtomic(path.join(dir, "structures.json"), structures);
    }
    return {
      project,
      version,
      pml: version?.pml ?? "",
      scene: deriveScene(version?.pml ?? "", structures),
      structures,
      messages,
      events,
      versions
    };
  }

  shareDir(shareId) {
    assertShareId(shareId);
    return path.join(this.root, "shares", shareId);
  }

  async createShare(token, projectId) {
    return this.withProjectLock(token, projectId, async () => {
      const dir = this.projectDir(token, projectId);
      const projectFile = path.join(dir, "project.json");
      const project = await readJson(projectFile, null);
      if (!project) {
        const error = new Error("对话不存在");
        error.status = 404;
        throw error;
      }

      const workspace = await this.getWorkspace(token, projectId);
      const now = new Date().toISOString();
      const shareId =
        project.share?.id ||
        `shr_${randomUUID().replaceAll("-", "")}${randomUUID()
          .replaceAll("-", "")
          .slice(0, 16)}`;
      assertShareId(shareId);
      const shareDir = this.shareDir(shareId);
      const structuresDir = path.join(shareDir, "structures");
      await mkdir(structuresDir, { recursive: true });

      const versions = (
        await Promise.all(
          workspace.versions.map((version) =>
            this.getVersion(token, projectId, version.id)
          )
        )
      ).filter(Boolean);
      for (const structure of workspace.structures) {
        await copyFile(
          path.join(dir, "structures", structure.storageName),
          path.join(structuresDir, structure.storageName)
        );
      }

      const share = {
        id: shareId,
        createdAt: project.share?.createdAt || now,
        updatedAt: now
      };
      const snapshot = {
        schemaVersion: 1,
        share,
        project: {
          id: project.id,
          title: project.title,
          createdAt: project.createdAt,
          updatedAt: project.updatedAt
        },
        version: workspace.version,
        pml: workspace.pml,
        structures: workspace.structures.map(publicStructure),
        messages: workspace.messages.map(publicMessage),
        versions
      };
      await writeJsonAtomic(path.join(shareDir, "snapshot.json"), snapshot);
      project.share = share;
      await writeJsonAtomic(projectFile, project);
      return { share: publicShareMetadata(share), snapshot };
    });
  }

  async getShare(shareId) {
    const snapshot = await readJson(
      path.join(this.shareDir(shareId), "snapshot.json"),
      null
    );
    if (!snapshot) {
      const error = new Error("分享链接不存在或已停止");
      error.status = 404;
      throw error;
    }
    return snapshot;
  }

  async revokeShare(token, projectId) {
    return this.withProjectLock(token, projectId, async () => {
      const projectFile = path.join(
        this.projectDir(token, projectId),
        "project.json"
      );
      const project = await readJson(projectFile, null);
      if (!project) {
        const error = new Error("对话不存在");
        error.status = 404;
        throw error;
      }
      const shareId = project.share?.id;
      if (shareId) {
        await rm(this.shareDir(shareId), { recursive: true, force: true });
      }
      delete project.share;
      await writeJsonAtomic(projectFile, project);
      return { revoked: Boolean(shareId), shareId: shareId || null };
    });
  }

  async sharedStructurePath(shareId, structureId) {
    assertId(structureId, "structure");
    const snapshot = await this.getShare(shareId);
    const structure = snapshot.structures.find((item) => item.id === structureId);
    if (!structure) return null;
    return {
      structure,
      path: path.join(this.shareDir(shareId), "structures", structure.storageName)
    };
  }

  async listVersions(token, projectId) {
    const dir = this.projectDir(token, projectId);
    const index = await readJson(path.join(dir, "versions.json"), []);
    return [...index].sort((a, b) => b.revision - a.revision);
  }

  async getVersion(token, projectId, versionId) {
    if (!versionId) return null;
    assertId(versionId, "version");
    const file = path.join(
      this.projectDir(token, projectId),
      "versions",
      `${versionId}.json`
    );
    return readJson(file, null);
  }

  async saveVersion(token, projectId, options) {
    if (!options?._lockHeld) {
      return this.withProjectLock(token, projectId, () =>
        this.saveVersion(token, projectId, { ...options, _lockHeld: true })
      );
    }
    const {
      pml,
      actor,
      source,
      summary,
      baseVersionId,
      parentVersionId,
      eventKind = "scene.commit",
      clientId = null,
      objectIds = null
    } = options;
    if (typeof pml !== "string" || pml.length > 2_000_000) {
      const error = new Error("PML must be text smaller than 2 MB");
      error.status = 400;
      throw error;
    }
    const dir = this.projectDir(token, projectId);
    const projectFile = path.join(dir, "project.json");
    const project = await readJson(projectFile, null);
    if (!project) {
      const error = new Error("Project not found");
      error.status = 404;
      throw error;
    }
    if (
      baseVersionId !== undefined &&
      baseVersionId !== project.activeVersionId
    ) {
      const error = new Error("Scene changed in another edit");
      error.status = 409;
      error.currentVersionId = project.activeVersionId;
      throw error;
    }

    if (parentVersionId !== undefined && parentVersionId !== null) {
      const parent = await this.getVersion(token, projectId, parentVersionId);
      if (!parent) {
        const error = new Error("Parent version not found");
        error.status = 404;
        throw error;
      }
    }

    const revision = project.revision + 1;
    const id = `v${String(revision).padStart(6, "0")}_${randomUUID()
      .replaceAll("-", "")
      .slice(0, 8)}`;
    const now = new Date().toISOString();
    const normalizedPml = normalizePml(pml);
    const version = {
      id,
      revision,
      parentId: parentVersionId || project.activeVersionId,
      createdAt: now,
      actor: actor || "human",
      source: source || "editor",
      summary: summary || "Updated PML",
      pml: normalizedPml,
      sha256: createHash("sha256").update(normalizedPml).digest("hex")
    };

    await writeJsonAtomic(path.join(dir, "versions", `${id}.json`), version);
    const versions = await readJson(path.join(dir, "versions.json"), []);
    versions.push({
      id,
      revision,
      parentId: version.parentId,
      createdAt: now,
      actor: version.actor,
      source: version.source,
      summary: version.summary,
      sha256: version.sha256
    });
    await writeJsonAtomic(path.join(dir, "versions.json"), versions);

    project.revision = revision;
    project.activeVersionId = id;
    project.updatedAt = now;
    await writeJsonAtomic(projectFile, project);
    await this.appendEvent(token, projectId, {
      kind: eventKind,
      actor: version.actor,
      source: version.source,
      versionId: id,
      parentVersionId: version.parentId,
      summary: version.summary,
      pmlSha256: version.sha256,
      objectIds: Array.isArray(objectIds)
        ? objectIds.filter((id) => project.structureIds?.includes(id))
        : [...(project.structureIds || [])]
    });
    await this.notifyWorkspaceUpdated(token, {
      type: "workspace.updated",
      action: eventKind,
      projectId,
      sessionId: projectId,
      conversationId: projectId,
      versionId: id,
      revision,
      objectIds: Array.isArray(objectIds)
        ? objectIds.filter((id) => project.structureIds?.includes(id))
        : [...(project.structureIds || [])],
      source: version.source,
      actor: version.actor,
      clientId,
      updatedAt: now
    });
    return version;
  }

  async restoreVersion(
    token,
    projectId,
    versionId,
    baseVersionId,
    clientId = null
  ) {
    const target = await this.getVersion(token, projectId, versionId);
    if (!target) {
      const error = new Error("Version not found");
      error.status = 404;
      throw error;
    }
    return this.saveVersion(token, projectId, {
      pml: target.pml,
      actor: "human",
      source: "history",
      summary: `恢复到版本 ${target.revision}`,
      baseVersionId,
      parentVersionId: target.id,
      eventKind: "scene.restore",
      clientId
    });
  }

  async appendMessage(token, projectId, message, options = {}) {
    if (!options._lockHeld) {
      return this.withProjectLock(token, projectId, () =>
        this.appendMessage(token, projectId, message, { _lockHeld: true })
      );
    }
    const dir = this.projectDir(token, projectId);
    const record = {
      id: `msg_${randomUUID().replaceAll("-", "").slice(0, 16)}`,
      createdAt: new Date().toISOString(),
      ...message
    };
    await appendJsonLine(path.join(dir, "messages.jsonl"), record);
    return record;
  }

  async replaceMessages(token, projectId, messages, options = {}) {
    if (!options._lockHeld) {
      return this.withProjectLock(token, projectId, () =>
        this.replaceMessages(token, projectId, messages, { _lockHeld: true })
      );
    }
    const dir = this.projectDir(token, projectId);
    const createdAt = Date.now();
    const records = messages.map((message, index) => ({
      id: `msg_${randomUUID().replaceAll("-", "").slice(0, 16)}`,
      createdAt: new Date(
        createdAt - Math.max(0, messages.length - index - 1)
      ).toISOString(),
      ...message
    }));
    const serialized = records.length
      ? `${records.map((record) => JSON.stringify(record)).join("\n")}\n`
      : "";
    await writeTextAtomic(path.join(dir, "messages.jsonl"), serialized);
    return records;
  }

  async appendEvent(token, projectId, event) {
    const dir = this.projectDir(token, projectId);
    const record = {
      id: `evt_${randomUUID().replaceAll("-", "").slice(0, 16)}`,
      createdAt: new Date().toISOString(),
      ...event
    };
    await appendJsonLine(path.join(dir, "events.jsonl"), record);
    return record;
  }

  async notifyWorkspaceUpdated(token, event) {
    if (typeof this.onWorkspaceUpdated !== "function") return;
    try {
      await this.onWorkspaceUpdated(token, event);
    } catch (error) {
      console.error("ChatPyMOL workspace event failed:", error);
    }
  }

  async addStructure(token, projectId, file, options = {}) {
    if (!options._lockHeld) {
      return this.withProjectLock(token, projectId, () =>
        this.addStructure(token, projectId, file, {
          ...options,
          _lockHeld: true
        })
      );
    }
    const ext = extensionOf(file.originalname);
    if (!STRUCTURE_EXTENSIONS.has(ext)) {
      const error = new Error(`不支持的结构格式：.${ext || "未知"}`);
      error.status = 400;
      throw error;
    }
    const dir = this.projectDir(token, projectId);
    const projectFile = path.join(dir, "project.json");
    const project = await readJson(projectFile, null);
    if (!project) {
      const error = new Error("Project not found");
      error.status = 404;
      throw error;
    }
    if (
      options.baseVersionId !== undefined &&
      options.baseVersionId !== project.activeVersionId
    ) {
      const error = new Error("Scene changed in another edit");
      error.status = 409;
      error.currentVersionId = project.activeVersionId;
      throw error;
    }
    const structuresFile = path.join(dir, "structures.json");
    const structures = await readJson(structuresFile, []);
    const id = `str_${randomUUID().replaceAll("-", "").slice(0, 16)}`;
    const filename = sanitizeFilename(file.originalname, id, ext);
    const objectName = uniqueObjectName(
      filename.replace(/\.(?:gz\.)?[^.]+$/i, ""),
      structures
    );
    const storageName = `${id}.${ext}`;
    await writeFile(path.join(dir, "structures", storageName), file.buffer);
    const record = {
      id,
      filename,
      storageName,
      objectName,
      format: normalizeFormat(ext),
      metadata: summarizeStructureMetadata(file.buffer, normalizeFormat(ext)),
      bytes: file.size,
      createdAt: new Date().toISOString(),
      sha256: createHash("sha256").update(file.buffer).digest("hex")
    };
    structures.push(record);
    await writeJsonAtomic(structuresFile, structures);
    project.structureIds.push(id);
    project.updatedAt = new Date().toISOString();
    await writeJsonAtomic(projectFile, project);

    const active = await this.getVersion(
      token,
      projectId,
      project.activeVersionId
    );
    const loadLine = `load ${filename}, ${objectName}`;
    const nextPml = `${managedHeader(record)}\n${active?.pml ?? DEFAULT_PML}`;
    const version = await this.saveVersion(token, projectId, {
      pml: nextPml,
      actor: options.actor || "human",
      source: options.source || "upload",
      summary: options.summary || `上传 ${filename}`,
      baseVersionId: project.activeVersionId,
      eventKind: options.eventKind || "structure.upload",
      clientId: options.clientId || null,
      _lockHeld: true
    });
    await this.appendEvent(token, projectId, {
      kind: "structure.asset",
      actor: options.actor || "human",
      source: options.source || "upload",
      versionId: version.id,
      structureId: id,
      filename,
      command: loadLine
    });
    return { structure: record, version };
  }

  async withProjectLock(token, projectId, callback) {
    const key = `${this.deviceId(token)}:${projectId}`;
    const previous = this.projectLocks.get(key) || Promise.resolve();
    let release;
    const gate = new Promise((resolve) => {
      release = resolve;
    });
    const tail = previous.then(() => gate);
    this.projectLocks.set(key, tail);
    await previous;
    try {
      return await callback();
    } finally {
      release();
      if (this.projectLocks.get(key) === tail) this.projectLocks.delete(key);
    }
  }

  async withDeviceLock(token, callback) {
    const key = this.deviceId(token);
    const previous = this.deviceLocks.get(key) || Promise.resolve();
    let release;
    const gate = new Promise((resolve) => {
      release = resolve;
    });
    const tail = previous.then(() => gate);
    this.deviceLocks.set(key, tail);
    await previous;
    try {
      return await callback();
    } finally {
      release();
      if (this.deviceLocks.get(key) === tail) this.deviceLocks.delete(key);
    }
  }

  async structurePath(token, projectId, structureId) {
    assertId(structureId, "structure");
    const dir = this.projectDir(token, projectId);
    const structures = await readJson(path.join(dir, "structures.json"), []);
    const structure = structures.find((item) => item.id === structureId);
    if (!structure) return null;
    return {
      structure,
      path: path.join(dir, "structures", structure.storageName)
    };
  }
}

function managedHeader(structure) {
  return [
    `# @chatpymol structure=${structure.id} sha256=${structure.sha256}`,
    `load ${structure.filename}, ${structure.objectName}`
  ].join("\n");
}

function deriveScene(pml, structures) {
  const scene = {
    schemaVersion: 1,
    objects: structures.map((item) => ({
      id: item.id,
      name: item.objectName,
      filename: item.filename,
      format: item.format,
      representations: [],
      colors: []
    })),
    selections: [],
    commands: [],
    background: null,
    camera: null,
    warnings: []
  };
  for (const command of parsePmlCommands(pml)) {
    scene.commands.push(command);
    const [verb, rest = ""] = splitOnce(command, /\s+/);
    const lower = verb.toLowerCase();
    if (lower === "bg_color") scene.background = rest.trim();
    if (lower === "show") {
      const [representation, selection = "all"] = rest.split(",", 2);
      scene.objects.forEach((object) => {
        if (
          selection.trim() === "all" ||
          selection.includes(object.name) ||
          selection.trim() === ""
        ) {
          object.representations.push(representation.trim());
        }
      });
    }
    if (lower === "color") {
      const [color, selection = "all"] = rest.split(",", 2);
      scene.objects.forEach((object) => {
        if (selection.includes(object.name) || selection.trim() === "all") {
          object.colors.push({ color: color.trim(), selection: selection.trim() });
        }
      });
    }
    if (lower === "select") {
      const [name, expression = ""] = rest.split(",", 2);
      scene.selections.push({ name: name.trim(), expression: expression.trim() });
    }
  }
  scene.objects.forEach((object) => {
    object.representations = [...new Set(object.representations)];
  });
  return scene;
}

export function parsePmlCommands(pml) {
  const commands = [];
  let pending = "";
  for (const rawLine of String(pml).split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    pending += (pending ? " " : "") + line.replace(/\\$/, "").trim();
    if (line.endsWith("\\")) continue;
    for (const part of pending.split(";")) {
      if (part.trim()) commands.push(part.trim());
    }
    pending = "";
  }
  if (pending) commands.push(pending);
  return commands;
}

function splitOnce(value, separator) {
  const match = value.match(separator);
  if (!match || match.index === undefined) return [value, ""];
  return [value.slice(0, match.index), value.slice(match.index + match[0].length)];
}

function normalizePml(pml) {
  return `${String(pml).replaceAll("\r\n", "\n").trimEnd()}\n`;
}

function cleanTitle(title) {
  return String(title || "未命名分子场景").trim().slice(0, 120);
}

function publicShareMetadata(share) {
  if (!share?.id) return null;
  return {
    id: share.id,
    path: `/share/${share.id}`,
    createdAt: share.createdAt,
    updatedAt: share.updatedAt
  };
}

function publicStructure(structure) {
  return {
    id: structure.id,
    filename: structure.filename,
    storageName: structure.storageName,
    objectName: structure.objectName,
    format: structure.format,
    metadata: structure.metadata,
    bytes: structure.bytes,
    createdAt: structure.createdAt,
    sha256: structure.sha256
  };
}

function publicMessage(message) {
  const allowed = [
    "id",
    "createdAt",
    "role",
    "content",
    "contentEn",
    "mode",
    "demoStep",
    "versionId",
    "structureIds",
    "actor",
    "source"
  ];
  return Object.fromEntries(
    allowed
      .filter((key) => message[key] !== undefined)
      .map((key) => [key, message[key]])
  );
}

function assertShareId(value) {
  if (!/^shr_[a-f0-9]{48}$/.test(String(value || ""))) {
    const error = new Error("Invalid share id");
    error.status = 404;
    throw error;
  }
}

function extensionOf(filename) {
  const lower = String(filename).toLowerCase();
  if (lower.endsWith(".mmcif")) return "mmcif";
  return path.extname(lower).slice(1);
}

function normalizeFormat(ext) {
  if (ext === "ent") return "pdb";
  if (ext === "mmcif") return "cif";
  return ext;
}

function sanitizeFilename(filename, fallback, ext) {
  const base = path
    .basename(String(filename))
    .replace(/[^\p{L}\p{N}._-]+/gu, "_")
    .slice(0, 160);
  return base && base !== `.${ext}` ? base : `${fallback}.${ext}`;
}

function uniqueObjectName(filename, structures) {
  const root =
    filename.replace(/[^\p{L}\p{N}_-]+/gu, "_").replace(/^_+|_+$/g, "") ||
    "molecule";
  const used = new Set(structures.map((item) => item.objectName));
  if (!used.has(root)) return root;
  let index = 2;
  while (used.has(`${root}_${index}`)) index += 1;
  return `${root}_${index}`;
}

export function summarizeStructureMetadata(buffer, format) {
  if (format === "pdb") return summarizePdb(buffer);
  if (format === "cif") return summarizeCif(buffer);
  return {
    schemaVersion: 1,
    available: false,
    format,
    reason: "该格式暂未生成文本结构清单"
  };
}

function summarizePdb(buffer) {
  const chains = new Map();
  const heteroGroups = new Map();
  const alternateLocations = new Set();
  const models = new Set();
  let atomCount = 0;
  let waterAtomCount = 0;
  let experimentalMethod = null;
  let resolutionAngstrom = null;

  for (const line of String(buffer || "").split(/\r?\n/)) {
    if (line.startsWith("MODEL ")) {
      models.add(line.slice(10, 14).trim() || String(models.size + 1));
      continue;
    }
    if (line.startsWith("EXPDTA")) {
      experimentalMethod = line.slice(6).trim() || experimentalMethod;
      continue;
    }
    if (line.startsWith("REMARK   2 RESOLUTION.")) {
      const match = line.match(/RESOLUTION\.\s+([0-9.]+)\s+ANGSTROMS/i);
      if (match) resolutionAngstrom = Number(match[1]);
      continue;
    }

    const record = line.slice(0, 6).trim();
    if (record !== "ATOM" && record !== "HETATM") continue;
    atomCount += 1;
    const alt = line.slice(16, 17).trim();
    if (alt) alternateLocations.add(alt);
    const residueName = line.slice(17, 20).trim() || "UNK";
    const chainId = line.slice(21, 22).trim() || "_";
    const residueNumber = line.slice(22, 26).trim() || "?";
    const insertionCode = line.slice(26, 27).trim();
    const residueId = `${residueNumber}${insertionCode}`;

    if (residueName === "HOH" || residueName === "WAT") {
      waterAtomCount += 1;
      continue;
    }

    if (record === "ATOM") {
      if (!chains.has(chainId)) {
        chains.set(chainId, { id: chainId, residues: [], seen: new Set() });
      }
      const chain = chains.get(chainId);
      const key = `${residueName}:${residueId}`;
      if (!chain.seen.has(key)) {
        chain.seen.add(key);
        chain.residues.push({ name: residueName, id: residueId });
      }
      continue;
    }

    const key = `${residueName}:${chainId}:${residueId}`;
    const current = heteroGroups.get(key) || {
      residueName,
      chainId,
      residueId,
      atomCount: 0
    };
    current.atomCount += 1;
    heteroGroups.set(key, current);
  }

  return {
    schemaVersion: 1,
    available: true,
    atomCount,
    modelCount: models.size || (atomCount ? 1 : 0),
    chains: [...chains.values()].map((chain) => ({
      id: chain.id,
      residueCount: chain.residues.length,
      firstResidue: chain.residues.at(0)?.id || null,
      lastResidue: chain.residues.at(-1)?.id || null
    })),
    heteroGroups: [...heteroGroups.values()].slice(0, 200),
    waterAtomCount,
    alternateLocations: [...alternateLocations].sort(),
    experimentalMethod,
    resolutionAngstrom
  };
}

function summarizeCif(buffer) {
  const lines = String(buffer || "").split(/\r?\n/);
  const headers = [];
  let dataStart = -1;
  for (let index = 0; index < lines.length; index += 1) {
    if (lines[index].trim() !== "loop_") continue;
    let cursor = index + 1;
    const candidate = [];
    while (cursor < lines.length && lines[cursor].trim().startsWith("_")) {
      candidate.push(lines[cursor].trim());
      cursor += 1;
    }
    if (candidate.some((name) => name.startsWith("_atom_site."))) {
      headers.push(...candidate);
      dataStart = cursor;
      break;
    }
  }
  if (dataStart < 0) {
    return {
      schemaVersion: 1,
      available: false,
      format: "cif",
      reason: "未找到 atom_site 数据表"
    };
  }

  const column = (names) => {
    for (const name of names) {
      const index = headers.indexOf(name);
      if (index >= 0) return index;
    }
    return -1;
  };
  const groupColumn = column(["_atom_site.group_PDB"]);
  const chainColumn = column([
    "_atom_site.auth_asym_id",
    "_atom_site.label_asym_id"
  ]);
  const sequenceColumn = column([
    "_atom_site.auth_seq_id",
    "_atom_site.label_seq_id"
  ]);
  const insertionColumn = column(["_atom_site.pdbx_PDB_ins_code"]);
  const residueColumn = column([
    "_atom_site.auth_comp_id",
    "_atom_site.label_comp_id"
  ]);
  const altColumn = column([
    "_atom_site.label_alt_id",
    "_atom_site.auth_alt_id"
  ]);
  const modelColumn = column(["_atom_site.pdbx_PDB_model_num"]);

  const chains = new Map();
  const heteroGroups = new Map();
  const alternateLocations = new Set();
  const models = new Set();
  let atomCount = 0;
  let waterAtomCount = 0;

  for (let index = dataStart; index < lines.length; index += 1) {
    const line = lines[index].trim();
    if (!line || line.startsWith("#")) continue;
    if (line === "loop_" || line.startsWith("_")) break;
    const values =
      line.match(/(?:[^\s"\x27]+|"[^"]*"|\x27[^\x27]*\x27)/g) || [];
    if (values.length < headers.length) continue;
    const clean = (value) =>
      String(value || "").replace(/^(["\x27])|(["\x27])$/g, "");
    const group = clean(values[groupColumn]) || "ATOM";
    const chainId = clean(values[chainColumn]) || "_";
    const residueNumber = clean(values[sequenceColumn]) || "?";
    const insertionCode = clean(values[insertionColumn]);
    const residueName = clean(values[residueColumn]) || "UNK";
    const residueId = `${residueNumber}${
      insertionCode && ![".", "?"].includes(insertionCode)
        ? insertionCode
        : ""
    }`;
    const alt = clean(values[altColumn]);
    const model = clean(values[modelColumn]);
    if (alt && ![".", "?"].includes(alt)) alternateLocations.add(alt);
    if (model && ![".", "?"].includes(model)) models.add(model);
    atomCount += 1;

    if (residueName === "HOH" || residueName === "WAT") {
      waterAtomCount += 1;
      continue;
    }
    if (group === "ATOM") {
      if (!chains.has(chainId)) {
        chains.set(chainId, { id: chainId, residues: [], seen: new Set() });
      }
      const chain = chains.get(chainId);
      const key = `${residueName}:${residueId}`;
      if (!chain.seen.has(key)) {
        chain.seen.add(key);
        chain.residues.push({ name: residueName, id: residueId });
      }
    } else {
      const key = `${residueName}:${chainId}:${residueId}`;
      const current = heteroGroups.get(key) || {
        residueName,
        chainId,
        residueId,
        atomCount: 0
      };
      current.atomCount += 1;
      heteroGroups.set(key, current);
    }
  }

  return {
    schemaVersion: 1,
    available: true,
    atomCount,
    modelCount: models.size || (atomCount ? 1 : 0),
    chains: [...chains.values()].map((chain) => ({
      id: chain.id,
      residueCount: chain.residues.length,
      firstResidue: chain.residues.at(0)?.id || null,
      lastResidue: chain.residues.at(-1)?.id || null
    })),
    heteroGroups: [...heteroGroups.values()].slice(0, 200),
    waterAtomCount,
    alternateLocations: [...alternateLocations].sort(),
    experimentalMethod: null,
    resolutionAngstrom: null
  };
}

function assertId(id, label) {
  if (!/^[A-Za-z0-9_-]{3,100}$/.test(id ?? "")) {
    const error = new Error(`Invalid ${label} id`);
    error.status = 400;
    throw error;
  }
}

async function readJson(file, fallback) {
  try {
    return JSON.parse(await readFile(file, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") return fallback;
    throw error;
  }
}

async function readJsonLines(file) {
  try {
    const content = await readFile(file, "utf8");
    return content
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line));
  } catch (error) {
    if (error.code === "ENOENT") return [];
    throw error;
  }
}

async function appendJsonLine(file, value) {
  await mkdir(path.dirname(file), { recursive: true });
  await appendFile(file, `${JSON.stringify(value)}\n`, "utf8");
}

async function writeJsonAtomic(file, value) {
  await writeTextAtomic(file, `${JSON.stringify(value, null, 2)}\n`);
}

async function writeTextAtomic(file, value) {
  await mkdir(path.dirname(file), { recursive: true });
  const temp = `${file}.${process.pid}.${randomUUID()}.tmp`;
  await writeFile(temp, value, "utf8");
  await rename(temp, file);
}
