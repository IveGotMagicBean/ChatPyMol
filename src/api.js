const DEVICE_TOKEN_KEY = "chatpymol.device-token.v1";
const CLIENT_ID_KEY = "chatpymol.client-id.v1";

export function getDeviceToken() {
  let token = localStorage.getItem(DEVICE_TOKEN_KEY);
  if (!token) {
    token = `dev_${crypto.randomUUID().replaceAll("-", "")}_${crypto
      .randomUUID()
      .replaceAll("-", "")}`;
    localStorage.setItem(DEVICE_TOKEN_KEY, token);
  }
  return token;
}

// A tab-scoped id is stable across reloads while still allowing two open tabs
// on the same device to receive each other's workspace updates.
export function getClientId() {
  let clientId = sessionStorage.getItem(CLIENT_ID_KEY);
  if (!clientId) {
    clientId = `web_${crypto.randomUUID().replaceAll("-", "")}`;
    sessionStorage.setItem(CLIENT_ID_KEY, clientId);
  }
  return clientId;
}

export class ApiClient {
  constructor(token, clientId = getClientId()) {
    this.token = token;
    this.clientId = clientId;
  }

  health() {
    return this.request("/api/health");
  }

  async bootstrap() {
    return this.request("/api/bootstrap", {
      method: "POST",
      body: JSON.stringify({
        deviceToken: this.token,
        clientId: this.clientId
      }),
      bootstrap: true
    });
  }

  eventsUrl() {
    const query = new URLSearchParams({
      deviceToken: this.token,
      clientId: this.clientId
    });
    return `/api/events?${query}`;
  }

  completePair(code) {
    return this.request("/api/integrations/pair/complete", {
      method: "POST",
      body: JSON.stringify({
        code,
        deviceToken: this.token,
        clientId: this.clientId
      }),
      bootstrap: true
    });
  }

  listProjects() {
    return this.request("/api/projects");
  }

  createProject(title = "新对话") {
    return this.request("/api/projects", {
      method: "POST",
      body: JSON.stringify({ title })
    });
  }

  activateProject(projectId) {
    return this.request(`/api/projects/${projectId}/activate`, { method: "POST" });
  }

  updateProject(projectId, changes) {
    return this.request(`/api/projects/${projectId}`, {
      method: "PATCH",
      body: JSON.stringify(changes)
    });
  }

  deleteProject(projectId) {
    return this.request(`/api/projects/${projectId}`, { method: "DELETE" });
  }

  getVersion(projectId, versionId) {
    return this.request(`/api/projects/${projectId}/versions/${versionId}`);
  }

  getProject(projectId) {
    return this.request(`/api/projects/${projectId}`);
  }

  savePml(projectId, pml, baseVersionId, summary = "Edited PML", options = {}) {
    return this.request(`/api/projects/${projectId}/pml`, {
      method: "POST",
      body: JSON.stringify({ pml, baseVersionId, summary, source: options.source || "editor", parentVersionId: options.parentVersionId, publishToChat: options.publishToChat, message: options.message })
    });
  }

  askAi(projectId, message, baseVersionId) {
    return this.request(`/api/projects/${projectId}/ai`, {
      method: "POST",
      body: JSON.stringify({ message, baseVersionId })
    });
  }

  restore(projectId, versionId, baseVersionId) {
    return this.request(`/api/projects/${projectId}/restore`, {
      method: "POST",
      body: JSON.stringify({ versionId, baseVersionId })
    });
  }

  uploadStructures(projectId, files) {
    const form = new FormData();
    for (const file of files) form.append("files", file);
    return this.request(`/api/projects/${projectId}/structures`, {
      method: "POST",
      body: form
    });
  }

  recommendations() {
    return this.request("/api/recommendations");
  }

  fetchRcsb(projectId, pdbId, format = "pdb") {
    return this.request(`/api/projects/${projectId}/fetch-rcsb`, {
      method: "POST",
      body: JSON.stringify({ pdbId, format })
    });
  }

  importPml(projectId, file, baseVersionId) {
    const form = new FormData();
    form.append("file", file);
    form.append("baseVersionId", baseVersionId);
    return this.request(`/api/projects/${projectId}/import-pml`, {
      method: "POST",
      body: form
    });
  }

  async downloadProject(projectId, fallbackName) {
    return this.download(
      `/api/projects/${projectId}/export.zip`,
      `${fallbackName || "chatpymol-project"}.zip`
    );
  }

  async downloadPml(projectId, fallbackName) {
    return this.download(
      `/api/projects/${projectId}/export.pml`,
      `${fallbackName || "chatpymol-scene"}.pml`
    );
  }

  async downloadStructure(projectId, structure) {
    return this.download(
      `/api/projects/${projectId}/structures/${structure.id}/download`,
      structure.filename
    );
  }

  async structureBytes(projectId, structure) {
    const response = await fetch(
      `/api/projects/${projectId}/structures/${structure.id}/download`,
      { headers: { "x-device-token": this.token } }
    );
    if (!response.ok) throw await toApiError(response);
    return new Uint8Array(await response.arrayBuffer());
  }

  async download(url, fallbackName) {
    const response = await fetch(url, {
      headers: { "x-device-token": this.token }
    });
    if (!response.ok) throw await toApiError(response);
    const blob = await response.blob();
    const disposition = response.headers.get("content-disposition") || "";
    const encoded = disposition.match(/filename\*=UTF-8''([^;]+)/i)?.[1];
    const plain = disposition.match(/filename="?([^";]+)"?/i)?.[1];
    const filename = encoded ? decodeURIComponent(encoded) : plain || fallbackName;
    const objectUrl = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = objectUrl;
    anchor.download = filename;
    anchor.click();
    URL.revokeObjectURL(objectUrl);
  }

  async request(url, options = {}) {
    const headers = new Headers(options.headers || {});
    if (!options.bootstrap) headers.set("x-device-token", this.token);
    headers.set("x-chatpymol-client-id", this.clientId);
    if (typeof options.body === "string") {
      headers.set("content-type", "application/json");
    }
    const response = await fetch(url, { ...options, headers });
    if (!response.ok) throw await toApiError(response);
    return response.json();
  }
}

async function toApiError(response) {
  let body = {};
  try {
    body = await response.json();
  } catch {
    body = { error: `${response.status} ${response.statusText}` };
  }
  const error = new Error(body.error || "Request failed");
  error.status = response.status;
  error.currentVersionId = body.currentVersionId;
  return error;
}
