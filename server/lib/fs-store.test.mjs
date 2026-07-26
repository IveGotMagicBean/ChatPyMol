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
