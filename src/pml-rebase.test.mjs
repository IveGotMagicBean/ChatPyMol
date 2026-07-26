import assert from "node:assert/strict";
import test from "node:test";
import { rebaseNativePmlDraft } from "./pml-rebase.js";

const VIEW_A = `# @chatpymol view-begin
set_view (1, 0, 0)
# @chatpymol view-end`;
const VIEW_B = `# @chatpymol view-begin
set_view (0, 1, 0)
# @chatpymol view-end`;

test("rebases appended native commands onto an external PML commit", () => {
  const base = "load 1aki.pdb, 1AKI\nshow cartoon\n";
  const draft = `${base}\n# PyMOL 原生界面操作\ncolor pink, 1AKI\n`;
  const latest = `${base}\n# codex\nshow sticks, organic\n`;
  const rebased = rebaseNativePmlDraft(base, draft, latest);

  assert.match(rebased, /show sticks, organic/);
  assert.match(rebased, /color pink, 1AKI/);
  assert.ok(
    rebased.indexOf("show sticks, organic") <
      rebased.indexOf("color pink, 1AKI")
  );
});

test("local managed view replaces the latest view without dropping external edits", () => {
  const base = `load 1aki.pdb, 1AKI\n${VIEW_A}\n`;
  const draft = `load 1aki.pdb, 1AKI\n\n${VIEW_B}\n`;
  const latest = `load 1aki.pdb, 1AKI\ncolor cyan, 1AKI\n\n${VIEW_A}\n`;
  const rebased = rebaseNativePmlDraft(base, draft, latest);

  assert.match(rebased, /color cyan, 1AKI/);
  assert.match(rebased, /set_view \(0, 1, 0\)/);
  assert.doesNotMatch(rebased, /set_view \(1, 0, 0\)/);
});

test("keeps the latest managed view when the local edit only appends commands", () => {
  const base = `load 1aki.pdb, 1AKI\n\n${VIEW_A}\n`;
  const draft = `${base}\ncolor pink, 1AKI\n`;
  const latest = `load 1aki.pdb, 1AKI\nshow surface, 1AKI\n\n${VIEW_B}\n`;
  const rebased = rebaseNativePmlDraft(base, draft, latest);

  assert.match(rebased, /show surface, 1AKI/);
  assert.match(rebased, /color pink, 1AKI/);
  assert.match(rebased, /set_view \(0, 1, 0\)/);
});

test("rejects drafts that rewrite earlier PML content", () => {
  const base = "load 1aki.pdb, 1AKI\ncolor blue, 1AKI\n";
  const draft = "load 1aki.pdb, 1AKI\ncolor pink, 1AKI\n";
  const latest = `${base}show sticks, organic\n`;

  assert.equal(rebaseNativePmlDraft(base, draft, latest), null);
});
