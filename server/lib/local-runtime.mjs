import { spawn } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import {
  chmod,
  mkdir,
  open,
  readFile,
  rename,
  unlink,
  writeFile
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const DEFAULT_PORT = 8787;
const packageRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../.."
);
const serverEntry = path.join(packageRoot, "server", "index.mjs");

export function resolveLocalPaths({
  stateDir,
  dataDir,
  configPath,
  envFile
} = {}) {
  const platformRoot =
    process.platform === "darwin"
      ? path.join(os.homedir(), "Library", "Application Support", "ChatPyMOL")
      : process.platform === "win32"
        ? path.join(
            process.env.LOCALAPPDATA || path.join(os.homedir(), "AppData", "Local"),
            "ChatPyMOL"
          )
        : null;
  const resolvedStateDir = path.resolve(
    stateDir ||
      process.env.CHATPYMOL_LOCAL_STATE_DIR ||
      (platformRoot
        ? path.join(platformRoot, "state")
        : path.join(
            process.env.XDG_STATE_HOME || path.join(os.homedir(), ".local", "state"),
            "chatpymol"
          ))
  );
  const resolvedDataDir = path.resolve(
    dataDir ||
      process.env.CHATPYMOL_LOCAL_DATA_DIR ||
      (platformRoot
        ? path.join(platformRoot, "data")
        : path.join(
            process.env.XDG_DATA_HOME || path.join(os.homedir(), ".local", "share"),
            "chatpymol",
            "data"
          ))
  );
  const resolvedConfigPath = path.resolve(
    configPath ||
      process.env.CHATPYMOL_CONFIG ||
      path.join(
        process.env.XDG_CONFIG_HOME || path.join(os.homedir(), ".config"),
        "chatpymol",
        "config.json"
      )
  );
  return {
    stateDir: resolvedStateDir,
    dataDir: resolvedDataDir,
    configPath: resolvedConfigPath,
    stateFile: path.join(resolvedStateDir, "local-server.json"),
    settingsFile: path.join(resolvedStateDir, "local-settings.json"),
    credentialsFile: path.join(resolvedStateDir, "local-credentials.json"),
    bindingsFile: path.join(resolvedStateDir, "codex-bindings.json"),
    logFile: path.join(resolvedStateDir, "local-server.log"),
    lockFile: path.join(resolvedStateDir, "local-server.lock"),
    envFile: path.resolve(
      envFile ||
        process.env.CHATPYMOL_LOCAL_ENV_FILE ||
        path.join(path.dirname(resolvedConfigPath), ".env")
    )
  };
}

export async function startLocalServer(options = {}) {
  const initialPaths = resolveLocalPaths(options);
  await mkdir(initialPaths.stateDir, { recursive: true, mode: 0o700 });
  const savedSettings = await readJson(initialPaths.settingsFile, {});
  const numericPort = normalizePort(
    options.port ||
      process.env.CHATPYMOL_LOCAL_PORT ||
      savedSettings.port ||
      DEFAULT_PORT
  );
  const paths = resolveLocalPaths({
    stateDir: options.stateDir,
    configPath: options.configPath,
    dataDir:
      options.dataDir ||
      process.env.CHATPYMOL_LOCAL_DATA_DIR ||
      savedSettings.dataDir,
    envFile:
      options.envFile ||
      process.env.CHATPYMOL_LOCAL_ENV_FILE ||
      savedSettings.envFile
  });
  await mkdir(paths.stateDir, { recursive: true, mode: 0o700 });
  await mkdir(paths.dataDir, { recursive: true, mode: 0o700 });

  return withLock(paths.lockFile, async () => {
    const existing = await localServerStatus({ stateDir: paths.stateDir });
    if (existing.running) {
      const credentials = await readLocalCredentials(paths);
      return { ...existing, alreadyRunning: true, token: credentials.token, paths };
    }
    if (existing.pidAlive) {
      throw new Error(
        `本地状态记录中的进程 ${existing.pid} 仍在运行，但无法确认它是当前 ChatPyMOL 实例；为避免误杀，请先检查 ${paths.logFile}`
      );
    }

    const baseUrl = `http://127.0.0.1:${numericPort}`;
    const occupied = await fetchHealth(baseUrl);
    if (occupied) {
      throw new Error(
        `${baseUrl} 已被其他服务占用。请使用 chatpymol local start --port <其他端口>`
      );
    }

    const credentials = await readLocalCredentials(paths, { create: true });
    const instanceId = `local_${randomUUID().replaceAll("-", "")}`;
    const logHandle = await open(paths.logFile, "a", 0o600);
    const selectedEnvFile = existsSync(paths.envFile) ? paths.envFile : null;
    const child = spawn(process.execPath, [serverEntry], {
      detached: true,
      stdio: ["ignore", logHandle.fd, logHandle.fd],
      env: {
        ...process.env,
        NODE_ENV: "production",
        HOST: "127.0.0.1",
        PORT: String(numericPort),
        DATA_DIR: paths.dataDir,
        CHATPYMOL_LOCAL_MODE: "1",
        CHATPYMOL_LOCAL_DEVICE_TOKEN: credentials.token,
        CHATPYMOL_INSTANCE_ID: instanceId,
        CHATPYMOL_PUBLIC_URL: baseUrl,
        ...(selectedEnvFile
          ? { CHATPYMOL_ENV_FILE: selectedEnvFile }
          : {})
      }
    });
    child.unref();
    await logHandle.close();

    const state = {
      schemaVersion: 1,
      pid: child.pid,
      instanceId,
      port: numericPort,
      host: "127.0.0.1",
      baseUrl,
      dataDir: paths.dataDir,
      envFile: selectedEnvFile,
      logFile: paths.logFile,
      startedAt: new Date().toISOString()
    };
    await writeJsonAtomic(paths.stateFile, state, 0o600);

    let health = null;
    for (let attempt = 0; attempt < 120; attempt += 1) {
      health = await fetchHealth(baseUrl);
      if (
        health?.ok &&
        health.localMode === true &&
        health.instanceId === instanceId
      ) {
        break;
      }
      if (!isPidAlive(child.pid)) break;
      await delay(250);
    }
    if (
      !health?.ok ||
      health.localMode !== true ||
      health.instanceId !== instanceId
    ) {
      if (isPidAlive(child.pid)) process.kill(child.pid, "SIGTERM");
      await safeUnlink(paths.stateFile);
      const tail = await readLogTail(paths.logFile);
      throw new Error(
        `本地 ChatPyMOL 启动失败。日志：${paths.logFile}${tail ? `\n${tail}` : ""}`
      );
    }

    try {
      await bootstrapLocal(baseUrl, credentials.token);
    } catch (error) {
      if (isPidAlive(child.pid)) process.kill(child.pid, "SIGTERM");
      await safeUnlink(paths.stateFile);
      throw error;
    }
    await writeJsonAtomic(
      paths.settingsFile,
      {
        schemaVersion: 1,
        port: numericPort,
        dataDir: paths.dataDir,
        envFile: selectedEnvFile,
        updatedAt: new Date().toISOString()
      },
      0o600
    );
    return {
      running: true,
      alreadyRunning: false,
      pid: child.pid,
      pidAlive: true,
      instanceId,
      port: numericPort,
      host: "127.0.0.1",
      baseUrl,
      dataDir: paths.dataDir,
      envFile: selectedEnvFile,
      logFile: paths.logFile,
      startedAt: state.startedAt,
      token: credentials.token,
      health,
      paths
    };
  });
}

export async function localServerStatus({ stateDir } = {}) {
  const paths = resolveLocalPaths({ stateDir });
  const state = await readJson(paths.stateFile, null);
  if (!state) {
    return {
      running: false,
      pid: null,
      pidAlive: false,
      baseUrl: null,
      dataDir: paths.dataDir,
      logFile: paths.logFile,
      paths
    };
  }
  const pidAlive = isPidAlive(state.pid);
  const health = await fetchHealth(state.baseUrl);
  const running = Boolean(
    pidAlive &&
      health?.ok &&
      health.localMode === true &&
      health.instanceId === state.instanceId
  );
  return {
    ...state,
    running,
    pidAlive,
    health,
    paths
  };
}

export async function stopLocalServer({ stateDir, timeoutMs = 5_000 } = {}) {
  const status = await localServerStatus({ stateDir });
  if (!status.pid) return { ...status, stopped: true, alreadyStopped: true };
  if (!status.pidAlive) {
    await safeUnlink(status.paths.stateFile);
    return { ...status, running: false, stopped: true, alreadyStopped: true };
  }
  if (!status.running) {
    throw new Error(
      `无法确认 PID ${status.pid} 是当前 ChatPyMOL 本地实例，已拒绝停止以避免误杀`
    );
  }
  process.kill(status.pid, "SIGTERM");
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline && isPidAlive(status.pid)) {
    await delay(100);
  }
  if (isPidAlive(status.pid)) {
    throw new Error(
      `ChatPyMOL 本地进程 ${status.pid} 未在 ${timeoutMs}ms 内退出；请检查 ${status.logFile}`
    );
  }
  await safeUnlink(status.paths.stateFile);
  return {
    ...status,
    running: false,
    pidAlive: false,
    stopped: true,
    alreadyStopped: false
  };
}

export async function readLocalCredentials(pathsOrOptions = {}, options = {}) {
  const paths = pathsOrOptions.credentialsFile
    ? pathsOrOptions
    : resolveLocalPaths(pathsOrOptions);
  let credentials = await readJson(paths.credentialsFile, null);
  if (!credentials && options.create) {
    credentials = {
      schemaVersion: 1,
      token: `dev_local_${randomBytes(32).toString("hex")}`,
      createdAt: new Date().toISOString()
    };
    await writeJsonAtomic(paths.credentialsFile, credentials, 0o600);
  }
  if (
    !credentials ||
    !/^[A-Za-z0-9_-]{20,160}$/.test(String(credentials.token || ""))
  ) {
    throw new Error(
      `本地凭据不存在或无效：${paths.credentialsFile}。请先运行 chatpymol local start`
    );
  }
  return credentials;
}

export async function persistLocalCliConfig(local, explicitConfigPath) {
  const configPath = path.resolve(
    explicitConfigPath || local.paths?.configPath || resolveLocalPaths().configPath
  );
  const previous = await readJson(configPath, {});
  const previousIsRemote =
    previous.baseUrl &&
    !/^https?:\/\/(?:127\.0\.0\.1|localhost)(?::|\/|$)/i.test(previous.baseUrl);
  const next = {
    ...previous,
    ...(previousIsRemote
      ? {
          cloudProfile: {
            baseUrl: previous.baseUrl,
            token: previous.token,
            pairedAt: previous.pairedAt || null
          }
        }
      : {}),
    baseUrl: local.baseUrl,
    token: local.token,
    mode: "local",
    local: {
      baseUrl: local.baseUrl,
      dataDir: local.dataDir,
      stateDir: local.paths?.stateDir || null,
      envFile: local.envFile || null,
      updatedAt: new Date().toISOString()
    }
  };
  await writeJsonAtomic(configPath, next, 0o600);
  return { configPath, config: next };
}

export async function readJson(filename, fallback) {
  try {
    return JSON.parse(await readFile(filename, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") return fallback;
    throw error;
  }
}

export async function writeJsonAtomic(filename, value, mode = 0o600) {
  await mkdir(path.dirname(filename), { recursive: true, mode: 0o700 });
  const temporary = `${filename}.${process.pid}.${randomUUID()}.tmp`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode });
  await rename(temporary, filename);
  await chmod(filename, mode);
}

export async function withLock(filename, callback, timeoutMs = 10_000) {
  await mkdir(path.dirname(filename), { recursive: true, mode: 0o700 });
  const deadline = Date.now() + timeoutMs;
  let handle;
  while (!handle) {
    try {
      handle = await open(filename, "wx", 0o600);
    } catch (error) {
      if (error.code !== "EEXIST") throw error;
      if (Date.now() >= deadline) {
        throw new Error(`等待本地状态锁超时：${filename}`);
      }
      await delay(50);
    }
  }
  try {
    return await callback();
  } finally {
    await handle.close();
    await safeUnlink(filename);
  }
}

function normalizePort(value) {
  const port = Number(value);
  if (!Number.isInteger(port) || port < 1024 || port > 65535) {
    throw new Error("本地端口必须是 1024–65535 的整数");
  }
  return port;
}

async function bootstrapLocal(baseUrl, token) {
  const response = await fetch(`${baseUrl}/api/bootstrap`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ deviceToken: token, clientId: "local-runtime" })
  });
  if (!response.ok) {
    throw new Error(`初始化本地工作区失败：HTTP ${response.status}`);
  }
}

async function fetchHealth(baseUrl) {
  if (!baseUrl) return null;
  try {
    const response = await fetch(`${baseUrl}/api/health`, {
      signal: AbortSignal.timeout(500)
    });
    if (!response.ok) return { ok: false, status: response.status };
    return response.json();
  } catch {
    return null;
  }
}

function isPidAlive(pid) {
  if (!Number.isSafeInteger(Number(pid)) || Number(pid) <= 1) return false;
  try {
    process.kill(Number(pid), 0);
    return true;
  } catch (error) {
    return error.code === "EPERM";
  }
}

async function readLogTail(filename) {
  try {
    const text = await readFile(filename, "utf8");
    return text.slice(-2_000).trim();
  } catch {
    return "";
  }
}

async function safeUnlink(filename) {
  try {
    await unlink(filename);
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
