import { readFile } from "node:fs/promises";

const origin = "http://127.0.0.1:8787";
const token =
  "dev_conversation_api_20260726_v2_abcdefghijklmnopqrstuvwxyz0123456789";
const headers = {
  "content-type": "application/json",
  "x-device-token": token
};

const bootstrap = await request("/api/bootstrap", {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ deviceToken: token })
});
const originalId = bootstrap.project.id;
const created = await request("/api/projects", {
  method: "POST",
  headers,
  body: JSON.stringify({ title: "新对话" })
});
const createdId = created.project.id;

const renamed = await request(`/api/projects/${createdId}`, {
  method: "PATCH",
  headers,
  body: JSON.stringify({ title: "结构讨论", pinned: true })
});
if (renamed.projects[0].id !== createdId || !renamed.projects[0].pinned) {
  throw new Error("Pin sorting failed");
}

const form = new FormData();
form.append(
  "files",
  new Blob([await readFile("scripts/fixtures/mini.pdb")], {
    type: "chemical/x-pdb"
  }),
  "mini.pdb"
);
const uploaded = await request(`/api/projects/${createdId}/structures`, {
  method: "POST",
  headers: { "x-device-token": token },
  body: form
});
if (uploaded.workspace.structures.at(-1)?.filename !== "mini.pdb") {
  throw new Error("Structure upload failed");
}

const deleted = await request(`/api/projects/${createdId}`, {
  method: "DELETE",
  headers
});
if (deleted.workspace.project.id !== originalId) {
  throw new Error("Delete did not return the remaining active conversation");
}

console.log(
  JSON.stringify(
    {
      renamed: renamed.project.title,
      pinned: renamed.project.pinned,
      uploaded: uploaded.workspace.structures.at(-1).filename,
      deleteFallback: deleted.workspace.project.id === originalId
    },
    null,
    2
  )
);

async function request(path, options) {
  const response = await fetch(`${origin}${path}`, options);
  const body = await response.json();
  if (!response.ok) throw new Error(body.error || String(response.status));
  return body;
}
