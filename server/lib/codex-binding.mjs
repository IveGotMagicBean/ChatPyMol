import { createHash } from "node:crypto";
import path from "node:path";
import { RemoteChatPymolService } from "./chatpymol-service.mjs";
import {
  persistLocalCliConfig,
  readJson,
  resolveLocalPaths,
  startLocalServer,
  withLock,
  writeJsonAtomic
} from "./local-runtime.mjs";

const SESSION_TOOLS = new Set([
  "get_session",
  "list_objects",
  "select_session",
  "apply_pml",
  "fetch_pdb",
  "upload_structure",
  "get_version",
  "get_browser_link",
  "get_export_links"
]);

const MOLECULAR_TERMS = [
  ["PyMOL", /\bpymol\b/i],
  ["PDB", /\bpdb\b|蛋白结构库/i],
  ["蛋白", /蛋白|protein/i],
  ["核酸", /核酸|DNA|RNA|nucleic/i],
  ["分子", /分子|molecul/i],
  ["结构", /结构|structure/i],
  ["链", /(?:^|\s)chain(?:\s|$)|[A-Za-z0-9]链|链[条段]?/i],
  ["残基", /残基|residue/i],
  ["配体", /配体|ligand/i],
  ["口袋", /口袋|pocket/i],
  ["颜色", /颜色|着色|配色|粉色|粉红|蓝色|红色|绿色|黄色|紫色|color/i],
  ["标签", /标签|标注|label/i],
  ["距离", /距离|distance/i],
  ["比对", /比对|叠合|align|superpos/i],
  ["表面", /表面|surface/i],
  ["卡通", /卡通|cartoon|sticks?|spheres?/i]
];
const MOLECULAR_ANCHOR =
  /\bpymol\b|\bpdb\b|蛋白|protein|核酸|\bDNA\b|\bRNA\b|nucleic|分子|molecul|[A-Za-z0-9]\s*链|链\s*[A-Za-z0-9]|\bchain\s+[A-Za-z0-9]\b|残基|residue|配体|ligand|结合口袋|binding pocket/i;

export async function handleCodexHook(input, options = {}) {
  const eventName = String(input?.hook_event_name || "");
  const codexSessionId = String(input?.session_id || "").trim();
  if (!codexSessionId) return successOutput();

  try {
    const local = await (options.startLocalServer || startLocalServer)({
      stateDir: options.stateDir,
      dataDir: options.dataDir,
      configPath: options.configPath
    });
    await persistLocalCliConfig(local, options.configPath);
    const service =
      options.service ||
      new RemoteChatPymolService({
        baseUrl: local.baseUrl,
        token: local.token,
        source: "codex-hook",
        clientId: `codex-hook-${process.pid}`
      });
    const binding = await ensureCodexBinding({ input, local, service });

    if (eventName === "UserPromptSubmit") {
      const relevance = summarizeMolecularPrompt(input.prompt);
      if (relevance) {
        await recordPromptEvent({
          local,
          binding,
          input,
          relevance,
          fetchImpl: options.fetchImpl || fetch
        });
      }
      return contextOutput(binding, local, "UserPromptSubmit");
    }

    if (eventName === "PreToolUse") {
      const toolName = String(input.tool_name || "");
      const shortName = toolName.split("__").at(-1);
      const toolInput =
        input.tool_input && typeof input.tool_input === "object"
          ? input.tool_input
          : {};
      if (
        /^mcp__chatpymol__/.test(toolName) &&
        SESSION_TOOLS.has(shortName) &&
        !toolInput.sessionId
      ) {
        return {
          hookSpecificOutput: {
            hookEventName: "PreToolUse",
            permissionDecision: "allow",
            updatedInput: {
              ...toolInput,
              sessionId: binding.chatpymolSessionId
            },
            additionalContext: bindingContext(binding, local)
          }
        };
      }
      return successOutput();
    }

    if (eventName === "SessionStart") {
      return contextOutput(binding, local, "SessionStart");
    }
    return successOutput();
  } catch (error) {
    return {
      continue: true,
      systemMessage: `ChatPyMOL 本地工作区暂未绑定：${error?.message || error}`
    };
  }
}

export async function ensureCodexBinding({ input, local, service }) {
  const codexSessionHash = digest(input.session_id);
  const paths = local.paths;
  return withLock(`${paths.bindingsFile}.lock`, async () => {
    const registry = await readJson(paths.bindingsFile, {
      schemaVersion: 1,
      bindings: {}
    });
    let binding = registry.bindings?.[codexSessionHash] || null;
    if (binding) {
      try {
        await service.getSession(binding.chatpymolSessionId, {
          historyLimit: 0
        });
      } catch (error) {
        if (error?.status !== 404) throw error;
        binding = null;
      }
    }

    if (!binding) {
      const cwdName = safeCwdName(input.cwd);
      const created = await service.createSession(
        `Codex · ${cwdName} · ${codexSessionHash.slice(0, 6)}`
      );
      binding = {
        codexSessionHash,
        chatpymolSessionId: created.session.id,
        cwdName,
        cwdFingerprint: digest(path.resolve(String(input.cwd || "."))),
        createdAt: new Date().toISOString(),
        lastSeenAt: new Date().toISOString(),
        lastTurnHash: null,
        lastPromptTurnHash: null
      };
    } else {
      binding.lastSeenAt = new Date().toISOString();
      if (input.turn_id) binding.lastTurnHash = digest(input.turn_id);
    }

    registry.schemaVersion = 1;
    registry.bindings = registry.bindings || {};
    registry.bindings[codexSessionHash] = binding;
    registry.updatedAt = new Date().toISOString();
    await writeJsonAtomic(paths.bindingsFile, registry, 0o600);
    await service.selectSession(binding.chatpymolSessionId);
    return binding;
  });
}

export async function listCodexBindings({ stateDir } = {}) {
  const paths = resolveLocalPaths({ stateDir });
  const registry = await readJson(paths.bindingsFile, {
    schemaVersion: 1,
    bindings: {}
  });
  return Object.values(registry.bindings || {}).sort((a, b) =>
    String(b.lastSeenAt || "").localeCompare(String(a.lastSeenAt || ""))
  );
}

export function summarizeMolecularPrompt(prompt) {
  const text = String(prompt || "");
  if (!MOLECULAR_ANCHOR.test(text)) return null;
  const labels = MOLECULAR_TERMS.filter(([, pattern]) => pattern.test(text))
    .map(([label]) => label)
    .slice(0, 6);
  if (!labels.length) return null;
  return {
    summary: `Codex 中的分子相关请求（涉及：${labels.join("、")}）`,
    topics: labels,
    characterCount: text.length
  };
}

async function recordPromptEvent({
  local,
  binding,
  input,
  relevance,
  fetchImpl
}) {
  const turnHash = input.turn_id ? digest(input.turn_id) : null;
  if (turnHash && binding.lastPromptTurnHash === turnHash) return;
  const response = await fetchImpl(
    `${local.baseUrl}/api/integrations/codex/prompt-event`,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-device-token": local.token,
        "x-chatpymol-source": "codex-hook"
      },
      body: JSON.stringify({
        sessionId: binding.chatpymolSessionId,
        codexSessionHash: binding.codexSessionHash,
        turnHash,
        summary: relevance.summary,
        topics: relevance.topics,
        characterCount: relevance.characterCount
      })
    }
  );
  if (!response.ok) {
    throw new Error(`记录 Codex 分子事件失败：HTTP ${response.status}`);
  }
  binding.lastPromptTurnHash = turnHash;
  await withLock(`${local.paths.bindingsFile}.lock`, async () => {
    const registry = await readJson(local.paths.bindingsFile, {
      schemaVersion: 1,
      bindings: {}
    });
    registry.bindings = registry.bindings || {};
    registry.bindings[binding.codexSessionHash] = {
      ...binding,
      ...(registry.bindings[binding.codexSessionHash] || {}),
      lastPromptTurnHash: turnHash
    };
    registry.updatedAt = new Date().toISOString();
    await writeJsonAtomic(local.paths.bindingsFile, registry, 0o600);
  });
}

function contextOutput(binding, local, hookEventName) {
  return {
    continue: true,
    hookSpecificOutput: {
      hookEventName,
      additionalContext: bindingContext(binding, local)
    }
  };
}

function bindingContext(binding, local) {
  const url = new URL(local.baseUrl);
  url.searchParams.set("session", binding.chatpymolSessionId);
  return (
    `此 Codex 主会话已绑定本机私有 ChatPyMOL Session ` +
    `${binding.chatpymolSessionId}（${binding.cwdName}）。` +
    `ChatPyMOL 工具未显式给出 sessionId 时使用该 Session；/resume 会复用同一绑定。` +
    `浏览器：${url.toString()}。不要读取 transcript_path，也不要同步整段对话。`
  );
}

function successOutput() {
  return { continue: true };
}

function safeCwdName(cwd) {
  const name = path.basename(path.resolve(String(cwd || ".")));
  return name.replace(/[^\p{L}\p{N}._-]+/gu, "-").slice(0, 48) || "workspace";
}

function digest(value) {
  return createHash("sha256")
    .update(String(value || ""))
    .digest("hex")
    .slice(0, 24);
}
