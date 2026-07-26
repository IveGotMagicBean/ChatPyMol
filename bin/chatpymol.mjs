#!/usr/bin/env node

import { spawn } from "node:child_process";
import { chmod, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { parseArgs } from "node:util";
import { RemoteChatPymolService } from "../server/lib/chatpymol-service.mjs";
import { runStdioMcpServer } from "../server/lib/mcp-server.mjs";

const DEFAULT_BASE_URL = "http://127.0.0.1:8787";

main().catch((error) => {
  const current = error?.currentVersionId
    ? `\n当前最新版：${error.currentVersionId}`
    : "";
  process.stderr.write(`ChatPyMOL CLI：${error?.message || error}${current}\n`);
  process.exitCode = error?.status === 409 ? 3 : 1;
});

async function main() {
  const [command = "help", ...args] = process.argv.slice(2);
  if (["help", "--help", "-h"].includes(command)) {
    printMainHelp();
    return;
  }
  if (["--version", "-v"].includes(command)) {
    process.stdout.write("chatpymol 0.2.0\n");
    return;
  }
  if (command === "pair" || command === "connect") {
    await pairCommand(args);
    return;
  }

  const parsed = parseCommand(command, args);
  if (parsed.values.help) {
    printCommandHelp(command);
    return;
  }
  const configPath = resolveConfigPath(parsed.values.config);
  const saved = await readConfig(configPath);
  const baseUrl = trimBaseUrl(
    parsed.values["base-url"] ||
      process.env.CHATPYMOL_BASE_URL ||
      saved.baseUrl ||
      DEFAULT_BASE_URL
  );
  const token =
    parsed.values.token || process.env.CHATPYMOL_TOKEN || saved.token || "";
  if (!token) {
    throw new Error(
      `尚未连接浏览器。请先运行：chatpymol pair --base-url ${baseUrl}`
    );
  }
  const source =
    parsed.values.source || process.env.CHATPYMOL_SOURCE || "cli";
  const service = new RemoteChatPymolService({
    baseUrl,
    token,
    source,
    clientId:
      process.env.CHATPYMOL_CLIENT_ID ||
      `cli-${os.hostname().replace(/[^A-Za-z0-9_.:-]/g, "-")}-${process.pid}`
  });

  if (command === "mcp") {
    process.stderr.write(`ChatPyMOL MCP 已连接 ${baseUrl}\n`);
    await runStdioMcpServer(service);
    return;
  }

  let result;
  switch (command) {
    case "status":
      result = await service.getWorkspace();
      break;
    case "sessions":
      result = await service.listSessions();
      break;
    case "show":
      result = await service.getSession(required(parsed.values.session, "--session"), {
        historyLimit: parsed.values["history-limit"],
        includeEvents: parsed.values.events
      });
      break;
    case "objects":
      result = await service.listObjects(
        required(parsed.values.session, "--session")
      );
      break;
    case "create":
      result = await service.createSession(parsed.values.title || "新对话");
      break;
    case "select":
      result = await service.selectSession(
        required(parsed.values.session, "--session")
      );
      break;
    case "apply":
      result = await service.applyPml({
        sessionId: required(parsed.values.session, "--session"),
        baseVersionId: required(
          parsed.values["base-version"],
          "--base-version"
        ),
        targetObjectIds: requiredList(parsed.values.object, "--object"),
        commands: parsed.values.command || [],
        summary: required(parsed.values.summary, "--summary")
      });
      break;
    case "fetch":
      result = await service.fetchPdb({
        sessionId: required(parsed.values.session, "--session"),
        baseVersionId: required(
          parsed.values["base-version"],
          "--base-version"
        ),
        pdbId: required(parsed.values.pdb, "--pdb"),
        format: parsed.values.format || "pdb"
      });
      break;
    case "upload": {
      const filename = path.resolve(required(parsed.values.file, "--file"));
      const bytes = await readFile(filename);
      result = await service.uploadStructure({
        sessionId: required(parsed.values.session, "--session"),
        baseVersionId: required(
          parsed.values["base-version"],
          "--base-version"
        ),
        filename: path.basename(filename),
        contentBase64: bytes.toString("base64")
      });
      break;
    }
    case "version":
      result = await service.getVersion(
        required(parsed.values.session, "--session"),
        required(parsed.values.version, "--version")
      );
      break;
    case "open":
      result = service.getBrowserLink(
        required(parsed.values.session, "--session"),
        parsed.values.version
      );
      if (parsed.values.launch) launchBrowser(result.browserUrl);
      break;
    case "export": {
      const sessionId = required(parsed.values.session, "--session");
      const format = parsed.values.format || "pml";
      const download = await service.downloadExport(sessionId, format);
      const output = path.resolve(
        parsed.values.output || path.basename(download.filename)
      );
      try {
        await writeFile(output, download.bytes, {
          flag: parsed.values.force ? "w" : "wx"
        });
      } catch (error) {
        if (error.code === "EEXIST") {
          throw new Error(
            `目标文件已存在：${output}。如需覆盖，请明确添加 --force`
          );
        }
        throw error;
      }
      result = {
        sessionId,
        format,
        output,
        bytes: download.bytes.length,
        overwritten: Boolean(parsed.values.force)
      };
      break;
    }
    case "exports":
      result = service.getExportLinks(
        required(parsed.values.session, "--session")
      );
      break;
    default:
      throw new Error(`未知命令：${command}。运行 chatpymol help 查看帮助。`);
  }
  printResult(command, result, Boolean(parsed.values.json));
}

async function pairCommand(args) {
  const parsed = parseArgs({
    args,
    allowPositionals: false,
    strict: true,
    options: {
      "base-url": { type: "string" },
      config: { type: "string" },
      timeout: { type: "string", default: "180" },
      launch: { type: "boolean", default: false },
      "no-wait": { type: "boolean", default: false },
      json: { type: "boolean", default: false },
      help: { type: "boolean", short: "h", default: false }
    }
  });
  if (parsed.values.help) {
    printCommandHelp("pair");
    return;
  }
  if (parsed.values["no-wait"] && !parsed.values.json) {
    throw new Error("--no-wait 仅供外部脚本使用，必须同时添加 --json");
  }
  const configPath = resolveConfigPath(parsed.values.config);
  const saved = await readConfig(configPath);
  const baseUrl = trimBaseUrl(
    parsed.values["base-url"] ||
      process.env.CHATPYMOL_BASE_URL ||
      saved.baseUrl ||
      DEFAULT_BASE_URL
  );
  const pair = await publicJson(`${baseUrl}/api/integrations/pair/start`, {
    method: "POST"
  });
  if (parsed.values.json) {
    process.stdout.write(
      `${JSON.stringify({
        code: pair.code,
        pairUrl: pair.pairUrl,
        expiresAt: pair.expiresAt,
        waiting: !parsed.values["no-wait"],
        ...(parsed.values["no-wait"]
          ? { pollSecret: pair.pollSecret }
          : {})
      })}\n`
    );
  } else {
    process.stdout.write(
      `浏览器配对码：${pair.code}\n打开：${pair.pairUrl}\n` +
        "等待浏览器确认…\n"
    );
  }
  if (parsed.values.launch) launchBrowser(pair.pairUrl);
  if (parsed.values["no-wait"]) return;

  const timeoutSeconds = clampNumber(parsed.values.timeout, 10, 600, 180);
  const deadline = Date.now() + timeoutSeconds * 1000;
  while (Date.now() < deadline) {
    await delay(1_000);
    const status = await publicJson(
      `${baseUrl}/api/integrations/pair/status?code=${encodeURIComponent(pair.code)}`,
      { headers: { "x-chatpymol-pair-secret": pair.pollSecret } }
    );
    if (status.status !== "paired") continue;
    await writeConfig(configPath, {
      baseUrl,
      token: status.token,
      pairedAt: status.completedAt || new Date().toISOString()
    });
    if (parsed.values.json) {
      process.stdout.write(
        `${JSON.stringify({
          status: "paired",
          baseUrl,
          configPath,
          tokenSaved: true
        })}\n`
      );
    } else {
      process.stdout.write(`已连接 ChatPyMOL，凭据已保存：${configPath}\n`);
    }
    return;
  }
  throw new Error(`配对超时（${timeoutSeconds} 秒），请重新运行 pair`);
}

function parseCommand(command, args) {
  const common = {
    "base-url": { type: "string" },
    token: { type: "string" },
    source: { type: "string" },
    config: { type: "string" },
    json: { type: "boolean", default: false },
    help: { type: "boolean", short: "h", default: false }
  };
  const commandOptions = {
    status: {},
    sessions: {},
    show: {
      session: { type: "string" },
      "history-limit": { type: "string", default: "20" },
      events: { type: "boolean", default: false }
    },
    objects: { session: { type: "string" } },
    create: { title: { type: "string", default: "新对话" } },
    select: { session: { type: "string" } },
    apply: {
      session: { type: "string" },
      "base-version": { type: "string" },
      object: { type: "string", multiple: true },
      command: { type: "string", multiple: true },
      summary: { type: "string" }
    },
    fetch: {
      session: { type: "string" },
      "base-version": { type: "string" },
      pdb: { type: "string" },
      format: { type: "string", default: "pdb" }
    },
    upload: {
      session: { type: "string" },
      "base-version": { type: "string" },
      file: { type: "string" }
    },
    version: {
      session: { type: "string" },
      version: { type: "string" }
    },
    open: {
      session: { type: "string" },
      version: { type: "string" },
      launch: { type: "boolean", default: false }
    },
    export: {
      session: { type: "string" },
      format: { type: "string", default: "pml" },
      output: { type: "string" },
      force: { type: "boolean", default: false }
    },
    exports: { session: { type: "string" } },
    mcp: {}
  };
  if (!Object.hasOwn(commandOptions, command)) {
    throw new Error(`未知命令：${command}`);
  }
  return parseArgs({
    args,
    allowPositionals: false,
    strict: true,
    options: { ...common, ...commandOptions[command] }
  });
}

function printResult(command, result, json) {
  if (json || !["status", "sessions", "apply", "fetch", "upload", "open", "export", "create", "select"].includes(command)) {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return;
  }
  if (command === "status") {
    process.stdout.write(
      `ChatPyMOL 已连接\n活动 Session：${result.activeSessionId || "无"}\n` +
        `当前版本：${result.activeVersionId || "无"}\nSession 数量：${result.sessions.length}\n` +
        `浏览器：${result.browserUrl}\n`
    );
    return;
  }
  if (command === "sessions") {
    const lines = result.sessions.map(
      (item) =>
        `${item.id === result.activeSessionId ? "*" : " "} ${item.id}  v${item.revision}  ${item.structureCount} 个对象  ${item.title}`
    );
    process.stdout.write(`${lines.join("\n") || "暂无 Session"}\n`);
    return;
  }
  if (command === "open") {
    process.stdout.write(`${result.browserUrl}\n`);
    return;
  }
  if (command === "export") {
    process.stdout.write(
      `已导出 ${result.format.toUpperCase()}：${result.output}（${result.bytes} bytes）\n`
    );
    return;
  }
  if (command === "create" || command === "select") {
    process.stdout.write(
      `Session：${result.session.id}\n版本：${result.version.id}\n浏览器：${result.browserUrl}\n`
    );
    return;
  }
  const object = result.structure ? `\n对象：${result.structure.objectName}` : "";
  process.stdout.write(
    `已生成版本 ${result.version.id}（v${result.version.revision}）${object}\n浏览器：${result.browserUrl}\n`
  );
}

function printMainHelp() {
  process.stdout.write(`ChatPyMOL CLI — AI 与人工共同维护版本化 PyMOL 场景

用法：chatpymol <命令> [选项]

连接：
  pair       用一次性短码连接浏览器设备（无需登录）
  status     查看工作区、活动 Session 和版本

Session 与对象：
  sessions   列出所有 Session
  show       读取指定 Session 的最新版 PML/历史
  objects    列出指定 Session 中的多个分子对象
  create     新建 Session
  select     让浏览器切换到指定 Session

修改与结构：
  apply      用原生 PyMOL 命令生成新版本
  fetch      从 RCSB 载入 PDB/mmCIF
  upload     上传本地结构文件
  version    读取一个历史版本
  open       获取指定 Session 浏览器深链（仅 --launch 才启动浏览器）
  export     实际下载 PML/项目 ZIP（默认不覆盖）
  exports    获取 PML/项目 ZIP 导出地址

Agent：
  mcp        启动 stdio MCP（供 Codex CLI / Claude Code 使用）

运行 chatpymol <命令> --help 查看示例。
环境变量：CHATPYMOL_BASE_URL、CHATPYMOL_TOKEN、CHATPYMOL_SOURCE。
优先级：显式命令行参数 > 环境变量 > pair 保存的配置 > 默认值。
重新 pair 前请清理旧 CHATPYMOL_TOKEN/CHATPYMOL_BASE_URL，避免旧环境变量继续覆盖新配置。
`);
}

function printCommandHelp(command) {
  const help = {
    pair: `chatpymol pair --base-url http://127.0.0.1:8787 [--launch] [--timeout 180]\n浏览器确认后自动保存本机 CLI 凭据；不需要登录。脚本模式可用 --no-wait --json，并自行安全保存返回的 pollSecret。`,
    status: `chatpymol status [--json]`,
    sessions: `chatpymol sessions [--json]`,
    show: `chatpymol show --session prj_... [--history-limit 20] [--events]`,
    objects: `chatpymol objects --session prj_...`,
    create: `chatpymol create --title "我的结构分析"`,
    select: `chatpymol select --session prj_...`,
    apply: `chatpymol apply --session prj_... --base-version v000002_... \\\n  --object str_... [--object str_... ...] \\\n  --command "hide everything" --command "show cartoon" \\\n  --summary "统一目标对象的展示方式"\n\n--object 必须至少出现一次，可重复传入任意多个真实对象，不要求恰好两个。用户要求“全部”时，先运行 objects，再为每个真实 ID 各传一次 --object。写入要求明确 Session 与 baseVersionId；若网页人工编辑抢先保存，命令会以退出码 3 拒绝覆盖。`,
    fetch: `chatpymol fetch --session prj_... --base-version v000002_... --pdb 1UBQ [--format cif]`,
    upload: `chatpymol upload --session prj_... --base-version v000002_... --file ./model.pdb`,
    version: `chatpymol version --session prj_... --version v000002_...`,
    open: `chatpymol open --session prj_... [--version v000002_...] [--launch]\n默认只打印浏览器深链；只有显式添加 --launch 才会启动本机浏览器。`,
    export: `chatpymol export --session prj_... --format pml|zip [--output ./scene.pml] [--force]\n默认使用服务器安全文件名，且已有文件不会被覆盖；只有明确 --force 才覆盖。`,
    exports: `chatpymol exports --session prj_...`,
    mcp: `chatpymol mcp\n在 stdout 上运行标准 MCP stdio；自动读取 pair 保存的凭据。`
  };
  process.stdout.write(`${help[command] || "暂无帮助"}\n`);
}

async function publicJson(url, options = {}) {
  const response = await fetch(url, options);
  if (!response.ok) {
    let body = {};
    try {
      body = await response.json();
    } catch {
      body = { error: `${response.status} ${response.statusText}` };
    }
    const error = new Error(body.error || "请求失败");
    error.status = response.status;
    throw error;
  }
  return response.json();
}

function resolveConfigPath(explicit) {
  if (explicit) return path.resolve(explicit);
  if (process.env.CHATPYMOL_CONFIG) {
    return path.resolve(process.env.CHATPYMOL_CONFIG);
  }
  const configRoot =
    process.env.XDG_CONFIG_HOME || path.join(os.homedir(), ".config");
  return path.join(configRoot, "chatpymol", "config.json");
}

async function readConfig(filename) {
  try {
    return JSON.parse(await readFile(filename, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") return {};
    throw new Error(`无法读取 CLI 配置 ${filename}：${error.message}`);
  }
}

async function writeConfig(filename, config) {
  await mkdir(path.dirname(filename), { recursive: true, mode: 0o700 });
  const temporary = `${filename}.${process.pid}.tmp`;
  await writeFile(temporary, `${JSON.stringify(config, null, 2)}\n`, {
    mode: 0o600
  });
  await rename(temporary, filename);
  await chmod(filename, 0o600);
}

function launchBrowser(url) {
  const command =
    process.platform === "darwin"
      ? "open"
      : process.platform === "win32"
        ? "cmd"
        : "xdg-open";
  const args = process.platform === "win32" ? ["/c", "start", "", url] : [url];
  try {
    const child = spawn(command, args, { detached: true, stdio: "ignore" });
    child.once("error", (error) => {
      process.stderr.write(`无法自动打开浏览器：${error.message}\n`);
    });
    child.unref();
  } catch (error) {
    process.stderr.write(`无法自动打开浏览器：${error.message}\n`);
  }
}

function required(value, flag) {
  if (value !== undefined && value !== null && String(value).trim()) return value;
  throw new Error(`缺少必填参数 ${flag}`);
}

function requiredList(value, flag) {
  if (Array.isArray(value) && value.length > 0) return value;
  throw new Error(
    `缺少必填参数 ${flag}；至少传入 1 个真实对象，可重复该参数指定任意多个对象`
  );
}

function trimBaseUrl(value) {
  const clean = String(value || "").trim().replace(/\/+$/, "");
  try {
    const url = new URL(clean);
    if (!/^https?:$/.test(url.protocol)) throw new Error();
    return url.toString().replace(/\/+$/, "");
  } catch {
    throw new Error(`无效的 ChatPyMOL 地址：${value}`);
  }
}

function clampNumber(value, minimum, maximum, fallback) {
  const number = Number(value);
  return Number.isFinite(number)
    ? Math.max(minimum, Math.min(maximum, number))
    : fallback;
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
