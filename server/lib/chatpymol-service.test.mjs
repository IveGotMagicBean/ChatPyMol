import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { FileStore } from "./fs-store.mjs";
import {
  LocalChatPymolService,
  RemoteChatPymolService
} from "./chatpymol-service.mjs";

test("MCP service keeps sessions and multiple objects explicit and rejects stale writes", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "chatpymol-service-test-"));
  const updates = [];
  const store = new FileStore(root, {
    onWorkspaceUpdated: (_token, event) => updates.push(event)
  });
  await store.init();
  const token = "device_service_test_12345678901234567890";
  const first = await store.bootstrap(token);
  const service = new LocalChatPymolService({
    store,
    token,
    baseUrl: "http://127.0.0.1:8787",
    source: "codex",
    clientId: "codex-test",
    downloadRcsb: async (pdbId) =>
      Buffer.from(`HEADER ${pdbId}\nATOM      1  CA  ALA A   1      0.0     0.0     0.0   1.00 20.00           C\nEND\n`)
  });

  const second = await service.createSession("多蛋白 Session");
  assert.notEqual(second.session.id, first.project.id);
  const loadedA = await service.fetchPdb({
    sessionId: second.session.id,
    baseVersionId: second.version.id,
    pdbId: "1UBQ",
    format: "pdb"
  });
  const loadedB = await service.fetchPdb({
    sessionId: second.session.id,
    baseVersionId: loadedA.version.id,
    pdbId: "1BNA",
    format: "pdb"
  });
  const objects = await service.listObjects(second.session.id);
  assert.equal(objects.objects.length, 2);
  assert.deepEqual(
    objects.objects.map((item) => item.objectName),
    ["1UBQ", "1BNA"]
  );

  for (const targetObjectIds of [undefined, []]) {
    await assert.rejects(
      service.applyPml({
        sessionId: second.session.id,
        baseVersionId: loadedB.version.id,
        ...(targetObjectIds === undefined ? {} : { targetObjectIds }),
        commands: ["color cyan, all"],
        summary: "不允许隐式全场景修改"
      }),
      (error) =>
        error.status === 400 && /至少 1 个真实 targetObjectIds/.test(error.message)
    );
  }

  const single = await service.applyPml({
    sessionId: second.session.id,
    baseVersionId: loadedB.version.id,
    targetObjectIds: [objects.objects[0].id],
    commands: ["color pink, 1UBQ"],
    summary: "修改一个明确对象"
  });
  assert.deepEqual(single.targetObjectIds, [objects.objects[0].id]);

  const edited = await service.applyPml({
    sessionId: second.session.id,
    baseVersionId: single.version.id,
    targetObjectIds: objects.objects.map((item) => item.id),
    commands: ["show cartoon, 1UBQ or 1BNA"],
    summary: "同时展示两个真实对象"
  });
  assert.equal(edited.version.source, "codex-mcp");
  assert.equal(edited.version.actor, "ai");
  assert.equal(edited.targetObjectIds.length, 2);
  assert.match(edited.version.pml, /show cartoon, 1UBQ or 1BNA/);
  assert.equal(
    updates.at(-1).sessionId,
    second.session.id
  );
  assert.deepEqual(updates.at(-1).objectIds, edited.targetObjectIds);

  await assert.rejects(
    service.applyPml({
      sessionId: second.session.id,
      baseVersionId: loadedB.version.id,
      targetObjectIds: objects.objects.map((item) => item.id),
      commands: ["color cyan, all"],
      summary: "过期修改"
    }),
    (error) =>
      error.status === 409 && error.currentVersionId === edited.version.id
  );

  const untouched = await service.getSession(first.project.id, {
    historyLimit: 0
  });
  assert.equal(untouched.objects.length, 0);
  assert.equal(untouched.version.id, first.version.id);
});

test("remote service rejects missing or empty targetObjectIds before network access", async () => {
  const service = new RemoteChatPymolService({
    baseUrl: "http://127.0.0.1:9",
    token: "device_remote_test_12345678901234567890",
    source: "claude"
  });
  let requests = 0;
  service.request = async () => {
    requests += 1;
    throw new Error("不应发出网络请求");
  };
  const base = {
    sessionId: "prj_abcdefgh",
    baseVersionId: "v000001_abcd",
    commands: ["show cartoon, all"],
    summary: "测试显式对象契约"
  };

  await assert.rejects(
    service.applyPml(base),
    (error) => error.status === 400 && /targetObjectIds/.test(error.message)
  );
  await assert.rejects(
    service.applyPml({ ...base, targetObjectIds: [] }),
    (error) => error.status === 400 && /targetObjectIds/.test(error.message)
  );
  assert.equal(requests, 0);
});
