import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  ensureCodexBinding,
  handleCodexHook,
  summarizeMolecularPrompt
} from "./codex-binding.mjs";
import { resolveLocalPaths } from "./local-runtime.mjs";

test("molecular prompt summaries never contain the original prompt", () => {
  const prompt = "把这个蛋白的 A 链改成绝密粉色，并标出配体距离";
  const result = summarizeMolecularPrompt(prompt);
  assert.deepEqual(result.topics, ["蛋白", "链", "配体", "颜色", "距离"]);
  assert.equal(result.summary.includes("绝密"), false);
  assert.equal(result.characterCount, prompt.length);
  assert.equal(summarizeMolecularPrompt("请修复 React 测试"), null);
  assert.equal(summarizeMolecularPrompt("请调整页面结构和蓝色按钮"), null);
});

test("Codex session binding is stable across resume and isolated across sessions", async () => {
  const fixture = await makeFixture();
  try {
    const first = await ensureCodexBinding({
      input: {
        session_id: "thr_alpha",
        turn_id: "turn_1",
        cwd: "/research/kinase"
      },
      local: fixture.local,
      service: fixture.service
    });
    const resumed = await ensureCodexBinding({
      input: {
        session_id: "thr_alpha",
        turn_id: "turn_2",
        cwd: "/research/kinase"
      },
      local: fixture.local,
      service: fixture.service
    });
    const other = await ensureCodexBinding({
      input: {
        session_id: "thr_beta",
        turn_id: "turn_1",
        cwd: "/research/kinase"
      },
      local: fixture.local,
      service: fixture.service
    });

    assert.equal(first.chatpymolSessionId, resumed.chatpymolSessionId);
    assert.notEqual(first.chatpymolSessionId, other.chatpymolSessionId);
    assert.equal(fixture.created, 2);
    const registry = JSON.parse(
      await readFile(fixture.local.paths.bindingsFile, "utf8")
    );
    assert.equal(Object.keys(registry.bindings).length, 2);
    assert.equal(
      JSON.stringify(registry).includes("thr_alpha"),
      false,
      "raw Codex session ids must not be persisted"
    );
    assert.equal(
      JSON.stringify(registry).includes("/research/kinase"),
      false,
      "full cwd must not be persisted"
    );
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test("PreToolUse injects the bound session and prompt sync sends summaries only", async () => {
  const fixture = await makeFixture();
  const requests = [];
  try {
    const common = {
      session_id: "thr_private",
      cwd: "/research/project-x"
    };
    await handleCodexHook(
      { ...common, hook_event_name: "SessionStart", source: "startup" },
      fixture.options
    );
    const preTool = await handleCodexHook(
      {
        ...common,
        hook_event_name: "PreToolUse",
        turn_id: "turn_1",
        tool_name: "mcp__chatpymol__get_session",
        tool_input: { historyLimit: 5 }
      },
      fixture.options
    );
    assert.match(
      preTool.hookSpecificOutput.updatedInput.sessionId,
      /^prj_[a-z0-9]{16}$/
    );
    assert.equal(preTool.hookSpecificOutput.updatedInput.historyLimit, 5);

    const secretPrompt = "把蛋白改成实验室机密粉色";
    fixture.options.fetchImpl = async (_url, options) => {
      requests.push(JSON.parse(options.body));
      return { ok: true };
    };
    await handleCodexHook(
      {
        ...common,
        hook_event_name: "UserPromptSubmit",
        turn_id: "turn_2",
        prompt: secretPrompt
      },
      fixture.options
    );
    await handleCodexHook(
      {
        ...common,
        hook_event_name: "UserPromptSubmit",
        turn_id: "turn_3",
        prompt: "请运行前端测试"
      },
      fixture.options
    );
    assert.equal(requests.length, 1);
    assert.equal(JSON.stringify(requests[0]).includes("机密"), false);
    assert.deepEqual(requests[0].topics, ["蛋白", "颜色"]);
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

async function makeFixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), "chatpymol-codex-"));
  const paths = resolveLocalPaths({
    stateDir: path.join(root, "state"),
    dataDir: path.join(root, "data"),
    configPath: path.join(root, "config.json")
  });
  const local = {
    running: true,
    alreadyRunning: true,
    baseUrl: "http://127.0.0.1:18787",
    token: "dev_local_abcdefghijklmnopqrstuvwxyz0123456789",
    dataDir: paths.dataDir,
    paths
  };
  const sessions = new Set();
  let created = 0;
  const service = {
    async createSession() {
      created += 1;
      const id = `prj_${String(created).padStart(16, "0")}`;
      sessions.add(id);
      return { session: { id } };
    },
    async getSession(sessionId) {
      if (!sessions.has(sessionId)) {
        const error = new Error("missing");
        error.status = 404;
        throw error;
      }
      return { session: { id: sessionId } };
    },
    async selectSession(sessionId) {
      return { selectedSessionId: sessionId };
    }
  };
  return {
    root,
    local,
    service,
    get created() {
      return created;
    },
    options: {
      stateDir: paths.stateDir,
      dataDir: paths.dataDir,
      configPath: paths.configPath,
      service,
      startLocalServer: async () => local
    }
  };
}
