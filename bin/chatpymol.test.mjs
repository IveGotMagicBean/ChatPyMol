import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";
import test from "node:test";
import { fileURLToPath } from "node:url";

const execFileAsync = promisify(execFile);
const cli = path.join(path.dirname(fileURLToPath(import.meta.url)), "chatpymol.mjs");

test("CLI reports 0.2.0", async () => {
  const { stdout } = await execFileAsync(process.execPath, [cli, "--version"]);
  assert.equal(stdout.trim(), "chatpymol 0.2.0");
});

test("CLI apply rejects a missing --object without contacting the server", async () => {
  await assert.rejects(
    execFileAsync(process.execPath, [
      cli,
      "apply",
      "--session",
      "prj_abcdefgh",
      "--base-version",
      "v000001_abcd",
      "--command",
      "show cartoon, all",
      "--summary",
      "测试",
      "--token",
      "device_cli_contract_test"
    ]),
    (error) =>
      error.code === 1 && /缺少必填参数 --object/.test(String(error.stderr))
  );
});
