const origin = "http://127.0.0.1:8787";
const token =
  "dev_bailian_skill_smoke_20260726_v2_abcdefghijklmnopqrstuvwxyz0123456789";
const bootstrap = await fetch(`${origin}/api/bootstrap`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ deviceToken: token })
}).then(read);

const result = await fetch(`${origin}/api/projects/${bootstrap.project.id}/ai`, {
  method: "POST",
  headers: {
    "content-type": "application/json",
    "x-device-token": token
  },
  body: JSON.stringify({
    message: "把当前场景设成白色背景，使用适合论文的正交视图",
    baseVersionId: bootstrap.version.id
  })
}).then(read);

console.log(
  JSON.stringify(
    {
      model: result.assistantMessage.model,
      mode: result.assistantMessage.mode,
      skills: result.assistantMessage.skills,
      revision: result.workspace.version.revision,
      summary: result.workspace.version.summary,
      conversationTitle: result.workspace.project.title,
      hasWhiteBackground: /bg_color\s+white/i.test(result.workspace.pml),
      hasOrthoscopic: /set\s+orthoscopic,\s*on/i.test(result.workspace.pml)
    },
    null,
    2
  )
);

if (/^(?:新对话|未命名分子场景|New chat)/.test(result.workspace.project.title)) {
  throw new Error("AI conversation title was not generated");
}

async function read(response) {
  const body = await response.json();
  if (!response.ok) throw new Error(body.error || `${response.status}`);
  return body;
}
