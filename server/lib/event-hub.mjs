import { createHash, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";

const DEFAULT_HEARTBEAT_MS = 20_000;
const DEFAULT_PAIR_TTL_MS = 3 * 60_000;

export class WorkspaceEventHub {
  constructor({ heartbeatMs = DEFAULT_HEARTBEAT_MS } = {}) {
    this.heartbeatMs = heartbeatMs;
    this.subscribers = new Map();
  }

  subscribe(token, response, { clientId = null } = {}) {
    const key = tokenKey(token);
    const subscriber = {
      id: randomUUID(),
      clientId: cleanClientId(clientId),
      response,
      heartbeat: null
    };
    if (!this.subscribers.has(key)) this.subscribers.set(key, new Map());
    this.subscribers.get(key).set(subscriber.id, subscriber);

    response.status(200);
    response.set({
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
      "x-accel-buffering": "no"
    });
    response.flushHeaders?.();
    response.write("retry: 1500\n");
    response.write(
      `event: connected\ndata: ${JSON.stringify({
        type: "connected",
        clientId: subscriber.clientId,
        connectedAt: new Date().toISOString()
      })}\n\n`
    );

    subscriber.heartbeat = setInterval(() => {
      if (!response.writableEnded) response.write(": heartbeat\n\n");
    }, this.heartbeatMs);
    subscriber.heartbeat.unref?.();

    const unsubscribe = () => this.unsubscribe(key, subscriber.id);
    response.on("close", unsubscribe);
    response.on("error", unsubscribe);
    return unsubscribe;
  }

  publish(token, event) {
    const subscribers = this.subscribers.get(tokenKey(token));
    if (!subscribers?.size) return 0;
    const payload = {
      type: "workspace.updated",
      updatedAt: new Date().toISOString(),
      ...event
    };
    const body = `event: workspace.updated\ndata: ${JSON.stringify(payload)}\n\n`;
    let delivered = 0;
    for (const subscriber of subscribers.values()) {
      if (subscriber.response.writableEnded) {
        this.unsubscribe(tokenKey(token), subscriber.id);
        continue;
      }
      subscriber.response.write(body);
      delivered += 1;
    }
    return delivered;
  }

  unsubscribe(key, subscriberId) {
    const subscribers = this.subscribers.get(key);
    const subscriber = subscribers?.get(subscriberId);
    if (!subscriber) return;
    if (subscriber.heartbeat) clearInterval(subscriber.heartbeat);
    subscribers.delete(subscriberId);
    if (!subscribers.size) this.subscribers.delete(key);
  }

  close() {
    for (const subscribers of this.subscribers.values()) {
      for (const subscriber of subscribers.values()) {
        if (subscriber.heartbeat) clearInterval(subscriber.heartbeat);
        if (!subscriber.response.writableEnded) subscriber.response.end();
      }
    }
    this.subscribers.clear();
  }
}

export class PairingBroker {
  constructor({
    ttlMs = DEFAULT_PAIR_TTL_MS,
    maxPending = 100,
    validateToken = () => true
  } = {}) {
    this.ttlMs = ttlMs;
    this.maxPending = maxPending;
    this.validateToken = validateToken;
    this.pending = new Map();
  }

  start(baseUrl) {
    this.cleanup();
    if (this.pending.size >= this.maxPending) {
      const error = new Error("配对请求过多，请稍后再试");
      error.status = 429;
      throw error;
    }
    const code = uniquePairCode(this.pending);
    const pollSecret = randomBytes(32).toString("base64url");
    const expiresAt = new Date(Date.now() + this.ttlMs).toISOString();
    this.pending.set(code, {
      pollSecretHash: secretHash(pollSecret),
      expiresAt,
      deviceToken: null,
      completedAt: null
    });
    const url = new URL(baseUrl);
    url.searchParams.set("pair", code);
    return { code, pollSecret, expiresAt, pairUrl: url.toString() };
  }

  complete(code, deviceToken) {
    const record = this.requirePair(code);
    this.validateToken(deviceToken);
    if (record.deviceToken) {
      const error = new Error("此配对码已经使用");
      error.status = 409;
      throw error;
    }
    record.deviceToken = deviceToken;
    record.completedAt = new Date().toISOString();
    return {
      status: "paired",
      code: normalizePairCode(code),
      completedAt: record.completedAt
    };
  }

  status(code, pollSecret) {
    const normalized = normalizePairCode(code);
    const record = this.requirePair(normalized);
    if (!sameSecret(record.pollSecretHash, secretHash(pollSecret))) {
      const error = new Error("配对轮询凭据无效");
      error.status = 401;
      throw error;
    }
    if (!record.deviceToken) {
      return { status: "pending", code: normalized, expiresAt: record.expiresAt };
    }
    this.pending.delete(normalized);
    return {
      status: "paired",
      code: normalized,
      token: record.deviceToken,
      completedAt: record.completedAt
    };
  }

  requirePair(code) {
    this.cleanup();
    const normalized = normalizePairCode(code);
    const record = this.pending.get(normalized);
    if (!record) {
      const error = new Error("配对码不存在或已过期");
      error.status = 404;
      throw error;
    }
    return record;
  }

  cleanup() {
    const now = Date.now();
    for (const [code, record] of this.pending) {
      if (Date.parse(record.expiresAt) <= now) this.pending.delete(code);
    }
  }
}

function tokenKey(token) {
  return createHash("sha256").update(String(token || "")).digest("hex");
}

function secretHash(secret) {
  return createHash("sha256").update(String(secret || "")).digest();
}

function sameSecret(left, right) {
  return left.length === right.length && timingSafeEqual(left, right);
}

function normalizePairCode(code) {
  return String(code || "").trim().toUpperCase();
}

function uniquePairCode(pending) {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  for (;;) {
    const bytes = randomBytes(8);
    let code = "";
    for (let index = 0; index < 8; index += 1) {
      code += alphabet[bytes[index] % alphabet.length];
    }
    if (!pending.has(code)) return code;
  }
}

function cleanClientId(clientId) {
  const value = String(clientId || "").trim();
  return /^[A-Za-z0-9_.:-]{1,160}$/.test(value) ? value : null;
}
