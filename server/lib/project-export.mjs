import { ZipArchive } from "archiver";

export async function streamProjectZip({
  response,
  store,
  token,
  projectId,
  workspace,
  filename
}) {
  response.type("application/zip");
  response.attachment(`${filename}.zip`);

  const archive = new ZipArchive({ zlib: { level: 9 } });
  const completed = new Promise((resolve, reject) => {
    response.on("close", resolve);
    archive.on("error", reject);
  });
  archive.pipe(response);

  archive.append(workspace.pml, { name: "scene.pml" });
  archive.append(
    `${JSON.stringify(
      {
        format: "ChatPyMOL project bundle",
        schemaVersion: 2,
        exportedAt: new Date().toISOString(),
        project: workspace.project,
        activeVersion: workspace.version,
        derivedScene: workspace.scene,
        structures: workspace.structures
      },
      null,
      2
    )}\n`,
    { name: "manifest.json" }
  );
  archive.append(`${JSON.stringify(workspace.versions, null, 2)}\n`, {
    name: "history/versions.json"
  });
  for (const versionMeta of [...workspace.versions].sort(
    (left, right) => left.revision - right.revision
  )) {
    const snapshot = await store.getVersion(token, projectId, versionMeta.id);
    if (!snapshot) continue;
    const revision = String(snapshot.revision).padStart(6, "0");
    archive.append(snapshot.pml, {
      name: `history/pml/v${revision}.pml`
    });
  }
  archive.append(
    workspace.events.map((entry) => JSON.stringify(entry)).join("\n") + "\n",
    { name: "history/events.jsonl" }
  );
  archive.append(
    workspace.messages.map((entry) => JSON.stringify(entry)).join("\n") + "\n",
    { name: "history/messages.jsonl" }
  );

  for (const structure of workspace.structures) {
    const stored = await store.structurePath(token, projectId, structure.id);
    if (stored) archive.file(stored.path, { name: `structures/${structure.filename}` });
  }

  await archive.finalize();
  await completed;
}
