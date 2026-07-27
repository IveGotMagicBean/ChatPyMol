import {
  Bot,
  Box,
  FileBox,
  History,
  Languages,
  LoaderCircle,
  LockKeyhole,
  Moon,
  Sun,
  TriangleAlert
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { SharedApiClient } from "./api";
import { NativePyMOLViewer } from "./components/NativePyMOLViewer";
import { createTranslator } from "./i18n";

export function SharedConversation({ shareId }) {
  const [snapshot, setSnapshot] = useState(null);
  const [selectedVersion, setSelectedVersion] = useState(null);
  const [error, setError] = useState("");
  const [theme, setTheme] = useState(
    () => localStorage.getItem("chatpymol.theme.v2") || "light"
  );
  const [language, setLanguage] = useState(
    () => localStorage.getItem("chatpymol.language") || "zh"
  );
  const api = useMemo(() => new SharedApiClient(shareId), [shareId]);
  const t = useMemo(() => createTranslator(language), [language]);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem("chatpymol.theme.v2", theme);
  }, [theme]);

  useEffect(() => {
    localStorage.setItem("chatpymol.language", language);
  }, [language]);

  useEffect(() => {
    const robots = document.createElement("meta");
    robots.name = "robots";
    robots.content = "noindex,nofollow,noarchive";
    document.head.appendChild(robots);
    return () => robots.remove();
  }, []);

  useEffect(() => {
    let cancelled = false;
    api
      .getShare()
      .then((payload) => {
        if (cancelled) return;
        setSnapshot(payload);
        setSelectedVersion(payload.version);
      })
      .catch((reason) => {
        if (!cancelled) setError(reason.message);
      });
    return () => {
      cancelled = true;
    };
  }, [api]);

  if (error) {
    return (
      <main className="shared-error-page">
        <span><TriangleAlert size={22} /></span>
        <h1>{t("分享链接不存在或已停止")}</h1>
        <a href="/">{t("返回 ChatPyMOL")}</a>
      </main>
    );
  }

  if (!snapshot || !selectedVersion) {
    return (
      <main className="clean-boot">
        <LoaderCircle className="spin" size={18} />
      </main>
    );
  }

  const versions = snapshot.versions || [];
  const versionMap = new Map(versions.map((version) => [version.id, version]));
  const structures = structuresInVersion(
    selectedVersion.pml,
    snapshot.structures || []
  );
  const selectedStructure = structures.at(-1);
  const visibleMessages = (snapshot.messages || []).filter(
    (message) =>
      message.mode !== "manual-edit" &&
      !(message.mode === "system" && message.content?.startsWith("欢迎来到 ChatPyMOL"))
  );

  return (
    <div className="shared-app">
      <header className="shared-nav">
        <div className="shared-brand">
          <span><Box size={16} /></span>
          <strong>ChatPyMOL</strong>
          <i>{t("只读分享")}</i>
        </div>
        <div className="shared-nav-actions">
          <a href="/">{t("返回 ChatPyMOL")}</a>
          <button
            type="button"
            onClick={() => setLanguage(language === "zh" ? "en" : "zh")}
            aria-label={t("切换中英文")}
          >
            <Languages size={15} />
            {language === "zh" ? "EN" : "中"}
          </button>
          <button
            type="button"
            onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
            aria-label={t("切换亮色或暗色")}
          >
            {theme === "dark" ? <Sun size={16} /> : <Moon size={16} />}
          </button>
        </div>
      </header>

      <main className="shared-layout">
        <section className="shared-conversation">
          <div className="shared-title">
            <span>{t("由 ChatPyMOL 创建")}</span>
            <h1>{snapshot.project.title}</h1>
            <p>
              {t("你可以旋转、缩放和查看不同版本；在此页面做的操作不会保存。")}
            </p>
          </div>
          <div className="shared-messages">
            {visibleMessages.map((message) => {
              const version = versionMap.get(message.versionId);
              return (
                <article
                  key={message.id}
                  className={`clean-message clean-message-${message.role}`}
                >
                  {message.role === "assistant" && (
                    <span className="clean-avatar"><Bot size={15} /></span>
                  )}
                  <div className="clean-message-content">
                    <p>
                      {language === "en" && message.contentEn
                        ? message.contentEn
                        : message.content}
                    </p>
                    {(message.structureIds || []).map((structureId) => {
                      const structure = snapshot.structures.find(
                        (item) => item.id === structureId
                      );
                      if (!structure) return null;
                      return (
                        <div className="message-structure-card shared" key={structure.id}>
                          <span className="message-structure-icon"><FileBox size={18} /></span>
                          <span className="message-structure-meta">
                            <strong>{structure.filename}</strong>
                            <small>{structure.format.toUpperCase()} · {formatBytes(structure.bytes)}</small>
                          </span>
                        </div>
                      );
                    })}
                    {version && (
                      <button
                        type="button"
                        className={`message-version-card ${
                          selectedVersion.id === version.id
                            ? "version-viewing"
                            : "version-history"
                        }`}
                        onClick={() => setSelectedVersion(version)}
                      >
                        <span className="message-version-icon"><History size={15} /></span>
                        <span className="message-version-meta">
                          <strong>v{version.revision} · {version.summary}</strong>
                          <small>
                            {version.actor === "ai" ? "AI" : t("人工")} · {formatTime(version.createdAt)}
                          </small>
                        </span>
                        <em>{selectedVersion.id === version.id ? t("查看中") : t("打开")}</em>
                      </button>
                    )}
                  </div>
                </article>
              );
            })}
          </div>
        </section>

        <aside className="shared-viewer-column">
          <div className="shared-readonly-note">
            <LockKeyhole size={13} />
            <span>{t("只读分享")}</span>
            <em>v{selectedVersion.revision}</em>
          </div>
          <NativePyMOLViewer
            api={api}
            projectId={snapshot.share.id}
            pml={selectedVersion.pml}
            structures={structures}
            versionId={selectedVersion.id}
            revision={selectedVersion.revision}
            exportName={`${safeDownloadName(snapshot.project.title)}-v${selectedVersion.revision}`}
            onDownloadStructure={
              selectedStructure
                ? () => api.downloadStructure(snapshot.share.id, selectedStructure)
                : undefined
            }
            onDownloadPml={() =>
              downloadText(
                selectedVersion.pml,
                `${safeDownloadName(snapshot.project.title)}-v${selectedVersion.revision}.pml`
              )
            }
            readOnly
            language={language}
            t={t}
          />
        </aside>
      </main>
    </div>
  );
}

function structuresInVersion(pml, structures) {
  const matched = structures.filter(
    (item) =>
      pml.includes(`# @chatpymol structure=${item.id}`) ||
      pml.includes(`load ${item.filename}`) ||
      pml.includes(`load "${item.filename}"`)
  );
  return matched.length ? matched : structures;
}

function formatBytes(value) {
  const bytes = Number(value) || 0;
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function formatTime(value) {
  return new Date(value).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function safeDownloadName(value) {
  return String(value || "chatpymol-share").replace(/[\\/:*?"<>|]+/g, "-").slice(0, 80);
}

function downloadText(content, filename) {
  const url = URL.createObjectURL(new Blob([content], { type: "application/x-pymol" }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}
