import { useEffect, useRef, useState } from "react";
import { Box, Cpu, LoaderCircle, MousePointer2, TriangleAlert } from "lucide-react";

export function MolecularViewer({
  api,
  projectId,
  pml,
  structures,
  versionId,
  onOutput,
  onUpload,
  onExamples,
  language,
  t = (value) => value
}) {
  const containerRef = useRef(null);
  const viewerRef = useRef(null);
  const [state, setState] = useState({
    kind: "loading",
    label: t("正在准备 WASM 渲染器")
  });

  useEffect(() => {
    let cancelled = false;

    async function renderScene() {
      if (!containerRef.current) return;
      setState({ kind: "loading", label: t("正在重放场景历史") });
      try {
        viewerRef.current?.destroy();
        viewerRef.current = null;
        containerRef.current.innerHTML = "";

        if (!navigator.gpu) {
          throw new Error(language === "en"
            ? "WebGPU is not available in this browser. Use the latest Chrome/Edge or connect the full PyMOL-WASM adapter."
            : "当前浏览器未开放 WebGPU。请使用最新版 Chrome/Edge，或接入完整的 PyMOL-WASM 适配器。");
        }

        const { PatinaeViewer } = await import("@patinae/viewer");
        if (cancelled) return;
        const viewer = new PatinaeViewer(containerRef.current, {
          picking: true,
          selectionOverlay: true,
          memoryProfile: "balanced"
        });
        viewerRef.current = viewer;
        await viewer.init();
        if (cancelled) { viewer.destroy(); return; }

        viewer.on("command-output", (message) => onOutput?.(message));
        viewer.on("atom-picked", (hit) => {
          if (hit?.expression) {
            onOutput?.({
              level: "info",
              text: `${language === "en" ? "Selected" : "已选择"} ${hit.expression}`
            });
          }
        });

        for (const structure of structures) {
          const bytes = await api.structureBytes(projectId, structure);
          if (cancelled) { viewer.destroy(); return; }
          viewer.loadData(bytes, structure.objectName, structure.format);
        }

        const warnings = [];
        for (const command of renderableCommands(pml)) {
          try {
            const result = viewer.execute(command);
            for (const message of result?.messages || []) {
              if (message.level === "error" || message.level === "warning") {
                warnings.push(message.text);
              }
            }
          } catch (error) {
            warnings.push(`${command}: ${error.message}`);
          }
        }
        setState({
          kind: warnings.length ? "warning" : "ready",
          label: warnings.length
            ? language === "en"
              ? `${warnings.length} command compatibility warning${warnings.length > 1 ? "s" : ""}`
              : `${warnings.length} 条命令兼容性提醒`
            : language === "en"
              ? `Version ${versionId?.match(/^v(\d+)/)?.[1]?.replace(/^0+/, "") || "1"} loaded`
              : `版本 ${versionId?.match(/^v(\d+)/)?.[1]?.replace(/^0+/, "") || "1"} 已载入`
        });
      } catch (error) {
        console.error(error);
        if (!cancelled) {
          setState({ kind: "error", label: error.message });
        }
      }
    }

    renderScene();
    return () => {
      cancelled = true;
      viewerRef.current?.destroy();
      viewerRef.current = null;
    };
  }, [api, projectId, pml, structures, versionId, onOutput, language, t]);

  return (
    <div className="viewer-stage">
      <div className="viewer-grid" />
      <div ref={containerRef} className="viewer-canvas" />
      {structures.length === 0 && state.kind !== "error" && (
        <div className="viewer-empty">
          <div className="orbital-mark" aria-hidden="true">
            <span />
            <span />
            <span />
            <Box size={28} />
          </div>
          <strong>{t("从一个蛋白结构开始")}</strong>
          <p>{t("上传 PDB/mmCIF，或从蛋白库下载，即可创建可追溯的分子场景。")}</p>
          <div className="viewer-empty-actions">
            <button onClick={onExamples}>{t("浏览示例玩法")}</button>
            <button onClick={onUpload}>{t("上传本地结构")}</button>
          </div>
        </div>
      )}
      {state.kind === "loading" && (
        <div className="viewer-loading">
          <LoaderCircle size={18} className="spin" />
          {state.label}
        </div>
      )}
      {state.kind === "error" && (
        <div className="viewer-error">
          <TriangleAlert size={22} />
          <div>
            <strong>{t("渲染器暂不可用")}</strong>
            <span>{state.label}</span>
          </div>
        </div>
      )}
      <div className={`renderer-status status-${state.kind}`}>
        <i />
        <Cpu size={13} />
        {state.label}
      </div>
      <div className="viewer-help">
        <MousePointer2 size={13} />
        {t("拖动旋转 · 滚轮缩放 · 点击选择")}
      </div>
    </div>
  );
}

function renderableCommands(pml) {
  const commands = [];
  let pending = "";
  for (const rawLine of String(pml).split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    pending += (pending ? " " : "") + line.replace(/\\$/, "").trim();
    if (line.endsWith("\\")) continue;
    for (const part of pending.split(";")) {
      const command = part.trim();
      if (!command) continue;
      // Structures are loaded from server bytes. These commands remain in the
      // exported PML but are not replayed by the preview adapter.
      if (
        /^(load|fetch|run|save|png|mpng|quit|reinitialize|system|shell|python)\b/i.test(
          command
        )
      ) {
        continue;
      }
      commands.push(command);
    }
    pending = "";
  }
  return commands;
}
