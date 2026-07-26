import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  FileStore,
  parsePmlCommands,
  summarizeStructureMetadata
} from "./fs-store.mjs";

test("parsePmlCommands handles comments, semicolons, and continuations", () => {
  assert.deepEqual(
    parsePmlCommands(`# comment
show cartoon; color red, chain A
select pocket, byres \\
  (organic around 5)
`),
    [
      "show cartoon",
      "color red, chain A",
      "select pocket, byres (organic around 5)"
    ]
  );
});

test("summarizeStructureMetadata extracts real PDB chains and hetero groups", () => {
  const pdb = [
    "EXPDTA    X-RAY DIFFRACTION",
    "REMARK   2 RESOLUTION.    1.80 ANGSTROMS.",
    "ATOM      1  N   ALA A   1      11.000  12.000  13.000  1.00 20.00           N",
    "ATOM      2  CA  ALA A   1      12.000  12.000  13.000  1.00 20.00           C",
    "ATOM      3  N   GLY B   7      13.000  12.000  13.000  1.00 20.00           N",
    "HETATM    4  C1  ATP B 201      14.000  12.000  13.000  1.00 20.00           C",
    "END"
  ].join("\n");
  const metadata = summarizeStructureMetadata(Buffer.from(pdb), "pdb");
  assert.equal(metadata.atomCount, 4);
  assert.deepEqual(metadata.chains.map((chain) => chain.id), ["A", "B"]);
  assert.equal(metadata.chains[0].residueCount, 1);
  assert.equal(metadata.heteroGroups[0].residueName, "ATP");
  assert.equal(metadata.resolutionAngstrom, 1.8);
});

test("workspace versions PML and rejects stale edits", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "chatpymol-test-"));
  const store = new FileStore(root);
  await store.init();
  const token = "device_token_12345678901234567890";
  const initial = await store.bootstrap(token);
  const first = await store.saveVersion(token, initial.project.id, {
    pml: `${initial.pml}\nshow sticks\n`,
    actor: "human",
    source: "test",
    summary: "show sticks",
    baseVersionId: initial.version.id
  });
  assert.equal(first.revision, 2);

  await assert.rejects(
    store.saveVersion(token, initial.project.id, {
      pml: initial.pml,
      actor: "human",
      source: "test",
      summary: "stale",
      baseVersionId: initial.version.id
    }),
    (error) => error.status === 409
  );
  const branched = await store.saveVersion(token, initial.project.id, {
    pml: `${initial.pml}\ncolor cyan\n`,
    actor: "human",
    source: "manual-edit",
    summary: "branch from first scene",
    baseVersionId: first.id,
    parentVersionId: initial.version.id
  });
  assert.equal(branched.revision, 3);
  assert.equal(branched.parentId, initial.version.id);

  const restored = await store.restoreVersion(
    token,
    initial.project.id,
    initial.version.id,
    branched.id
  );
  assert.equal(restored.revision, 4);
  assert.equal(restored.parentId, initial.version.id);
  assert.match(restored.summary, /恢复到版本 1/);

});

test("uploaded structure is stored and added to PML", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "chatpymol-test-"));
  const store = new FileStore(root);
  await store.init();
  const token = "device_token_abcdefghijklmnopqrstuvwxyz";
  const initial = await store.bootstrap(token);
  const result = await store.addStructure(token, initial.project.id, {
    originalname: "1crn.pdb",
    buffer: Buffer.from("HEADER TEST\nEND\n"),
    size: 16
  });
  const workspace = await store.getWorkspace(token, initial.project.id);
  assert.match(workspace.pml, /load 1crn\.pdb, 1crn/);
  const stored = await store.structurePath(
    token,
    initial.project.id,
    result.structure.id
  );
  assert.match(await readFile(stored.path, "utf8"), /HEADER TEST/);
});

test("replaceMessages installs an ordered bilingual conversation", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "chatpymol-test-"));
  const store = new FileStore(root);
  await store.init();
  const token = "device_token_replace_messages_abcdefghijklmnop";
  const initial = await store.bootstrap(token);
  const before = Date.now();
  const installed = await store.replaceMessages(token, initial.project.id, [
    {
      role: "user",
      content: "加载一个真实蛋白。",
      contentEn: "Load a real protein.",
      mode: "demo"
    },
    {
      role: "assistant",
      content: "已创建可回溯场景。",
      contentEn: "A reversible scene is ready.",
      mode: "demo"
    }
  ]);
  const workspace = await store.getWorkspace(token, initial.project.id);

  assert.equal(installed.length, 2);
  assert.deepEqual(
    workspace.messages.map(({ role, contentEn }) => ({ role, contentEn })),
    [
      { role: "user", contentEn: "Load a real protein." },
      { role: "assistant", contentEn: "A reversible scene is ready." }
    ]
  );
  assert.ok(
    Date.parse(workspace.messages[0].createdAt) <=
      Date.parse(workspace.messages[1].createdAt)
  );
  assert.ok(Date.parse(workspace.messages[1].createdAt) <= Date.now());
  assert.ok(Date.parse(workspace.messages[0].createdAt) >= before - 10);

  await store.appendMessage(token, initial.project.id, {
    role: "user",
    content: "继续编辑",
    mode: "human"
  });
  const continued = await store.getWorkspace(token, initial.project.id);
  assert.equal(continued.messages.length, 3);
  assert.equal(continued.messages.at(-1).content, "继续编辑");
});

test("inactive official example preserves the active project and deletion is final", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "chatpymol-test-"));
  const store = new FileStore(root);
  await store.init();
  const token = "device_token_official_example_lifecycle_abcdefghijklmnop";
  const initial = await store.bootstrap(token);
  const example = await store.createProject(token, "示例对话", {
    activate: false,
    officialExampleSchema: 6
  });
  let listed = await store.listProjects(token);
  let device = JSON.parse(
    await readFile(path.join(store.deviceDir(token), "device.json"), "utf8")
  );

  assert.equal(listed.activeProjectId, initial.project.id);
  assert.equal(listed.projects.length, 2);
  assert.equal(device.officialExample.status, "pending");
  assert.equal(device.officialExample.projectId, example.project.id);

  await store.markOfficialExample(token, 6, example.project.id, {
    status: "pending"
  });
  device = JSON.parse(
    await readFile(path.join(store.deviceDir(token), "device.json"), "utf8")
  );
  assert.equal(device.officialExample.status, "pending");

  await store.markOfficialExample(token, 6, example.project.id);
  device = JSON.parse(
    await readFile(path.join(store.deviceDir(token), "device.json"), "utf8")
  );
  assert.equal(device.officialExample.status, "installed");
  assert.ok(device.officialExample.installedAt);

  await store.deleteProject(token, example.project.id);
  listed = await store.listProjects(token);
  device = JSON.parse(
    await readFile(path.join(store.deviceDir(token), "device.json"), "utf8")
  );
  assert.equal(listed.activeProjectId, initial.project.id);
  assert.equal(listed.projects.length, 1);
  assert.equal(device.officialExample.status, "deleted");
  assert.equal(device.officialExample.projectId, null);
  assert.ok(device.officialExample.deletedAt);
});

test("concurrent device bootstrap does not duplicate the initial project", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "chatpymol-test-"));
  const store = new FileStore(root);
  await store.init();
  const token = "device_token_concurrent_bootstrap_abcdefghijklmnop";
  const results = await Promise.all(
    Array.from({ length: 10 }, () => store.bootstrap(token))
  );
  const listed = await store.listProjects(token);

  assert.equal(new Set(results.map((item) => item.project.id)).size, 1);
  assert.equal(listed.projects.length, 1);
});
