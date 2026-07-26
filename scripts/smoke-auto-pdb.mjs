const origin = "http://127.0.0.1:8787";
const token =
  "dev_auto_pdb_chat_20260726_v3_abcdefghijklmnopqrstuvwxyz0123456789";

const bootstrap = await request("/api/bootstrap", {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ deviceToken: token })
});

if (bootstrap.structures.at(-1)?.filename !== "1AKI.pdb") {
  throw new Error("Default example was not injected");
}

const emptyConversation = await request("/api/projects", {
  method: "POST",
  headers: {
    "content-type": "application/json",
    "x-device-token": token
  },
  body: JSON.stringify({ title: "新对话" })
});

const result = await request(
  `/api/projects/${emptyConversation.project.id}/ai`,
  {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-device-token": token
    },
    body: JSON.stringify({
      message: "你随便拉一个蛋白试一下，用卡通显示",
      baseVersionId: emptyConversation.version.id
    })
  }
);

const structure = result.workspace.structures.at(-1);
if (structure?.filename !== "1AKI.pdb") {
  throw new Error("Random-protein request did not load a real structure");
}
if (!result.workspace.project.title.includes("1AKI")) {
  throw new Error("Grounded conversation title does not match the real structure");
}

console.log(
  JSON.stringify(
    {
      title: result.workspace.project.title,
      defaultExample: bootstrap.structures.at(-1).filename,
      structure: structure.filename,
      object: structure.objectName,
      revision: result.workspace.version.revision,
      mode: result.assistantMessage.mode
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
