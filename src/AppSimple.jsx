import {
  Archive,
  Bot,
  Box,
  Check,
  ChevronRight,
  Clock3,
  Code2,
  Database,
  Download,
  Eye,
  FileBox,
  FileCode2,
  History,
  LoaderCircle,
  MessageSquare,
  MessagesSquare,
  Moon,
  Languages,
  PanelLeftClose,
  PanelLeftOpen,
  PanelRightClose,
  PanelRightOpen,
  Plus,
  Paperclip,
  RotateCcw,
  Save,
  Send,
  Sparkles,
  ShieldCheck,
  SlidersHorizontal,
  Sun,
  Undo2,
  Upload,
  UserRound,
  X
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ApiClient, getDeviceToken } from "./api";
import { createTranslator } from "./i18n";
import { MolecularViewer } from "./components/MolecularViewer";
import { ConversationSidebar } from "./components/ConversationSidebar";

const SKILL_LABELS = ["安全 PML", "配体与口袋", "链与配色", "论文级构图", "多结构组合", "蛋白界面"];

const EXAMPLES = [
  { id: "1CRN", label: "入门蛋白" },
  { id: "1UBQ", label: "泛素" },
  { id: "4HHB", label: "血红蛋白" },
  { id: "6M0J", label: "ACE2–RBD" }
];

export function AppSimple() {
  const token = useMemo(getDeviceToken, []);
  const api = useMemo(() => new ApiClient(token), [token]);
  const [workspace, setWorkspace] = useState(null);
  const [provider, setProvider] = useState({ aiMode: "local", model: "本地规则" });
  const [conversations, setConversations] = useState([]);
  const [theme, setTheme] = useState(() => {
    const saved = localStorage.getItem("chatpymol.theme");
    if (saved) return saved;
    return window.matchMedia?.("(prefers-color-scheme: dark)").matches
      ? "dark"
      : "light";
  });
  const [language, setLanguage] = useState(() => localStorage.getItem("chatpymol.language") || "zh");
  const [leftWidth, setLeftWidth] = useState(() => Number(localStorage.getItem("chatpymol.left-width")) || 255);
  const [rightWidth, setRightWidth] = useState(() => Number(localStorage.getItem("chatpymol.right-width")) || 660);
  const [leftCollapsed, setLeftCollapsed] = useState(false);
  const [rightCollapsed, setRightCollapsed] = useState(false);
  const t = useMemo(() => createTranslator(language), [language]);
  const [rightTab, setRightTab] = useState("scene");
  const [chatInput, setChatInput] = useState("");
  const [editorPml, setEditorPml] = useState("");
  const [previewVersion, setPreviewVersion] = useState(null);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [pdbId, setPdbId] = useState("");
  const [viewerOutput, setViewerOutput] = useState([]);
  const chatEndRef = useRef(null);
  const structureInputRef = useRef(null);
  const pmlInputRef = useRef(null);

  const applyWorkspace = useCallback((next) => {
    setWorkspace(next);
    setEditorPml(next.pml);
    setPreviewVersion(null);
    setError("");
    api.listProjects().then((result) => setConversations(result.projects)).catch(() => {});
  }, [api]);

  useEffect(() => {
    Promise.all([api.bootstrap(), api.health()])
      .then(([next, health]) => {
        applyWorkspace(next);
        setProvider(health);
      })
      .catch((reason) => setError(reason.message));
  }, [api, applyWorkspace]);

  useEffect(() => {
    document.documentElement.lang = language === "en" ? "en" : "zh-CN";
    localStorage.setItem("chatpymol.language", language);
  }, [language]);

  useEffect(() => {
    localStorage.setItem("chatpymol.left-width", String(leftWidth));
    localStorage.setItem("chatpymol.right-width", String(rightWidth));
  }, [leftWidth, rightWidth]);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem("chatpymol.theme", theme);
  }, [theme]);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [workspace?.messages?.length, busy]);

  const selectedVersion = previewVersion || workspace?.version;
  const selectedPml = previewVersion?.pml || workspace?.pml || "";
  const selectedStructures = useMemo(
    () => structuresInVersion(selectedPml, workspace?.structures || []),
    [selectedPml, workspace?.structures]
  );
  const isDirty = Boolean(workspace && editorPml !== workspace.pml);

  const onViewerOutput = useCallback((message) => {
    setViewerOutput((lines) => [...lines, message].slice(-10));
  }, []);

  async function preview(versionId) {
    if (!workspace || versionId === workspace.version.id) {
      setPreviewVersion(null);
      setEditorPml(workspace?.pml || "");
      setRightTab("scene");
      return;
    }
    setBusy(`preview:${versionId}`);
    setError("");
    try {
      const result = await api.getVersion(workspace.project.id, versionId);
      setPreviewVersion(result.version);
      setEditorPml(result.version.pml);
      setRightTab("scene");
    } catch (reason) {
      setError(reason.message);
    } finally {
      setBusy("");
    }
  }

  async function restore(versionId) {
    if (!workspace || busy) return;
    setBusy(`restore:${versionId}`);
    setError("");
    try {
      const result = await api.restore(
        workspace.project.id,
        versionId,
        workspace.version.id
      );
      applyWorkspace(result.workspace);
    } catch (reason) {
      await handleConflict(reason);
    } finally {
      setBusy("");
    }
  }

  async function savePml() {
    if (!workspace || !isDirty || busy) return;
    setBusy("save");
    setError("");
    try {
      const result = await api.savePml(
        workspace.project.id,
        editorPml,
        workspace.version.id,
        previewVersion
          ? `基于版本 ${previewVersion.revision} 继续编辑`
          : "人工编辑 PML"
      );
      applyWorkspace(result.workspace);
    } catch (reason) {
      await handleConflict(reason);
    } finally {
      setBusy("");
    }
  }

  async function handleConflict(reason) {
    if (reason.status === 409 && workspace) {
      const fresh = await api.getProject(workspace.project.id);
      applyWorkspace(fresh);
      setError("场景刚刚发生变化，已载入最新版本，请重新操作。");
      return;
    }
    setError(reason.message);
  }

  async function sendMessage(event) {
    event?.preventDefault();
    const message = chatInput.trim();
    if (!message || !workspace || busy) return;
    setChatInput("");
    setBusy("ai");
    setError("");
    const before = workspace;
    setWorkspace({
      ...workspace,
      messages: [
        ...workspace.messages,
        {
          id: `pending-${Date.now()}`,
          role: "user",
          content: message,
          createdAt: new Date().toISOString()
        }
      ]
    });
    try {
      const result = await api.askAi(
        before.project.id,
        message,
        before.version.id
      );
      applyWorkspace(result.workspace);
    } catch (reason) {
      setWorkspace(before);
      await handleConflict(reason);
    } finally {
      setBusy("");
    }
  }

  async function uploadStructures(files) {
    if (!workspace || !files?.length) return;
    setBusy("upload");
    setError("");
    try {
      const result = await api.uploadStructures(workspace.project.id, files);
      applyWorkspace(result.workspace);
      setRightTab("scene");
    } catch (reason) {
      setError(reason.message);
    } finally {
      setBusy("");
    }
  }

  async function importPml(file) {
    if (!workspace || !file) return;
    setBusy("import");
    setError("");
    try {
      const result = await api.importPml(
        workspace.project.id,
        file,
        workspace.version.id
      );
      applyWorkspace(result.workspace);
      setRightTab("pml");
    } catch (reason) {
      await handleConflict(reason);
    } finally {
      setBusy("");
    }
  }

  async function fetchProtein(value = pdbId) {
    const normalized = String(value).trim().toUpperCase();
    if (!/^[A-Z0-9]{4}$/.test(normalized)) {
      setError("请输入 4 位 PDB ID，例如 1UBQ。");
      return;
    }
    setBusy(`fetch:${normalized}`);
    setError("");
    try {
      const result = await api.fetchRcsb(
        workspace.project.id,
        normalized,
        "pdb"
      );
      applyWorkspace(result.workspace);
      setPdbId("");
      setRightTab("scene");
    } catch (reason) {
      setError(reason.message);
    } finally {
      setBusy("");
    }
  }

  function startResize(side, event) {
    event.preventDefault();
    const startX = event.clientX;
    const startWidth = side === "left" ? leftWidth : rightWidth;
    document.body.classList.add("is-resizing");
    const onMove = (moveEvent) => {
      if (side === "left") {
        const maxLeft = Math.max(
          210,
          Math.min(
            380,
            window.innerWidth - (rightCollapsed ? 0 : rightWidth) - 430
          )
        );
        setLeftWidth(
          Math.min(
            maxLeft,
            Math.max(210, startWidth + moveEvent.clientX - startX)
          )
        );
      } else {
        const maxRight = Math.max(460, window.innerWidth - (leftCollapsed ? 0 : leftWidth) - 430);
        setRightWidth(Math.min(maxRight, Math.max(460, startWidth - moveEvent.clientX + startX)));
      }
    };
    const onUp = () => {
      document.body.classList.remove("is-resizing");
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  }

  async function newConversation() {
    if (busy) return;
    setBusy("new-chat");
    try {
      const title = `${language === "en" ? "New chat" : "新对话"} ${new Date().toLocaleString(language === "en" ? "en-US" : "zh-CN", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" })}`;
      const next = await api.createProject(title);
      applyWorkspace(next);
      setRightTab("scene");
    } catch (reason) {
      setError(reason.message);
    } finally {
      setBusy("");
    }
  }

  async function switchConversation(projectId) {
    if (!workspace || projectId === workspace.project.id || busy) return;
    setBusy(`switch:${projectId}`);
    try {
      const next = await api.activateProject(projectId);
      applyWorkspace(next);
      setRightTab("scene");
    } catch (reason) {
      setError(reason.message);
    } finally {
      setBusy("");
    }
  }

  function addCommand(command, summary) {
    setEditorPml(
      `${workspace.pml.trimEnd()}\n\n# 人工快捷操作：${summary}\n${command}\n`
    );
    setPreviewVersion(null);
    setRightTab("pml");
  }

  if (!workspace) {
    return (
      <main className="simple-boot">
        <Mark />
        <LoaderCircle className="spin" size={18} />
        <span>{t("正在打开工作区")}</span>
        {error && <p>{error}</p>}
      </main>
    );
  }

  return (
    <div className="simple-app">
      <header className="simple-topbar">
        <div className="topbar-main">
          <button className="topbar-icon-button" onClick={() => setLeftCollapsed((value) => !value)} aria-label={t(leftCollapsed ? "展开左侧栏" : "收起左侧栏")}>
            {leftCollapsed ? <PanelLeftOpen size={17} /> : <PanelLeftClose size={17} />}
          </button>
          <div className="simple-brand">
          <Mark />
          <div>
            <strong>ChatPyMOL</strong>
            <span>{workspace.project.title}</span>
          </div>
        </div>
        </div>
        <div className="simple-state">
          <span className="saved-state">
            <Check size={13} />
            {t("已保存")}
          </span>
          <span className={`provider-state provider-${provider.aiMode}`}>
            <i />
            {provider.aiMode === "bailian"
              ? `${t("百炼")} · ${provider.model}`
              : provider.aiMode === "openai"
                ? provider.model
                : t("本地规则")}
          </span>
          <button className="topbar-icon-button" onClick={() => setRightCollapsed((value) => !value)} aria-label={t(rightCollapsed ? "展开右侧栏" : "收起右侧栏")}>
            {rightCollapsed ? <PanelRightOpen size={17} /> : <PanelRightClose size={17} />}
          </button>
          <button className="language-button" onClick={() => setLanguage(language === "zh" ? "en" : "zh")} aria-label={t("切换中英文")}>
            <Languages size={15} />
            {language === "zh" ? "EN" : "中"}
          </button>
          <button
            className="theme-button"
            onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
            aria-label={t("切换亮色或暗色")}
          >
            {theme === "dark" ? <Sun size={16} /> : <Moon size={16} />}
          </button>
        </div>
      </header>

      {error && (
        <div className="simple-error">
          <span>{error}</span>
          <button onClick={() => setError("")}>
            <X size={14} />
          </button>
        </div>
      )}

      <main className="three-columns">
        {!leftCollapsed && (
        <ConversationSidebar
          conversations={conversations}
          workspace={workspace}
          versions={workspace.versions}
          busy={busy}
          onNew={newConversation}
          onSwitch={switchConversation}
          style={{ width: leftWidth }}
          onPreview={preview}
          t={t}
        />
        )}
        {!leftCollapsed && <ResizeHandle label={t("调整左侧栏宽度")} side="left" onPointerDown={(event) => startResize("left", event)} />}

        <ConversationColumn
          workspace={workspace}
          busy={busy}
          chatInput={chatInput}
          setChatInput={setChatInput}
          onSubmit={sendMessage}
          onPreview={preview}
          t={t}
          versions={workspace.versions}
          structureInputRef={structureInputRef}
          chatEndRef={chatEndRef}
          language={language}
        />

        {!rightCollapsed && <ResizeHandle label={t("调整右侧栏宽度")} side="right" onPointerDown={(event) => startResize("right", event)} />}
        {!rightCollapsed && (
        <section className="right-column" style={{ width: rightWidth }}>
          <RightTabs value={rightTab} onChange={setRightTab} t={t} />

          {previewVersion && (
            <div className="preview-bar">
              <div>
                <Eye size={14} />
                {t("正在查看版本")} {previewVersion.revision}
              </div>
              <button onClick={() => preview(workspace.version.id)}>
                {t("返回当前版本")}
              </button>
              <button className="primary-mini" onClick={() => restore(previewVersion.id)}>
                {t("恢复到这里")}
              </button>
            </div>
          )}

          {rightTab === "scene" && (
            <div className="scene-pane">
              <div className="scene-quickbar">
                <span>
                  {t("版本")} {selectedVersion.revision} · {selectedStructures.length} {t("个结构")}
                </span>
                <div>
                  <button onClick={() => addCommand("show cartoon", "显示卡通")}>
                    {t("卡通")}
                  </button>
                  <button onClick={() => addCommand("show surface", "显示表面")}>
                    {t("表面")}
                  </button>
                  <button
                    onClick={() =>
                      addCommand(
                        "select ligand, organic\nshow sticks, ligand\nzoom ligand",
                        "显示配体"
                      )
                    }
                  >
                    {t("配体")}
                  </button>
                  <button onClick={() => addCommand("orient", "调整视角")}>
                    <RotateCcw size={13} />
                    {t("复位视角")}
                  </button>
                </div>
              </div>
              <div className="simple-viewer-wrap">
                <MolecularViewer
                  api={api}
                  projectId={workspace.project.id}
                  pml={selectedPml}
                  structures={selectedStructures}
                  versionId={selectedVersion.id}
                  onOutput={onViewerOutput}
                  onUpload={() => structureInputRef.current?.click()}
                  onExamples={() => setRightTab("files")}
                  language={language}
                  t={t}
                />
              </div>
              <div className="viewer-note">
                <span>{t("拖动旋转 · 滚轮缩放 · 点击选择")}</span>
                {viewerOutput.at(-1)?.text && <code>{viewerOutput.at(-1).text}</code>}
              </div>
            </div>
          )}

          {rightTab === "pml" && (
            <div className="pml-pane">
              <div className="file-toolbar">
                <div>
                  <FileCode2 size={15} />
                  <strong>scene.pml</strong>
                  <span>{editorPml.split("\n").length} {t("行")}</span>
                </div>
                <div>
                  <button onClick={() => pmlInputRef.current?.click()}>
                    <Upload size={14} />
                    {t("导入")}
                  </button>
                  <button
                    onClick={() =>
                      api.downloadPml(workspace.project.id, workspace.project.title)
                    }
                  >
                    <Download size={14} />
                    {t("导出")}
                  </button>
                  <button
                    className="save-button"
                    disabled={!isDirty || Boolean(busy)}
                    onClick={savePml}
                  >
                    {busy === "save" ? (
                      <LoaderCircle size={14} className="spin" />
                    ) : (
                      <Save size={14} />
                    )}
                    {t("保存并渲染")}
                  </button>
                </div>
              </div>
              <div className="simple-code-editor">
                <LineNumbers value={editorPml} />
                <textarea
                  value={editorPml}
                  onChange={(event) => setEditorPml(event.target.value)}
                  spellCheck="false"
                  aria-label={t("PML 编辑器")}
                />
              </div>
              <div className="editor-status">
                {isDirty
                  ? previewVersion
                    ? language === "en"
                      ? `Editing from version ${previewVersion.revision}; saving creates a new version`
                      : `正在基于历史版本 ${previewVersion.revision} 编辑，保存后会形成新版本`
                    : t("有尚未保存的人工修改")
                  : t("PML 已与当前版本同步")}
              </div>
            </div>
          )}

          {rightTab === "files" && (
            <FilesPane
              workspace={workspace}
              api={api}
              busy={busy}
              pdbId={pdbId}
              setPdbId={setPdbId}
              onFetch={fetchProtein}
              onUpload={() => structureInputRef.current?.click()}
              onImport={() => pmlInputRef.current?.click()}
              t={t}
            />
          )}
        </section>
        )}
      </main>

      <input
        ref={structureInputRef}
        type="file"
        multiple
        hidden
        accept=".pdb,.ent,.cif,.mmcif,.bcif,.mol2,.sdf,.mol,.xyz,.gro,.mrc,.ccp4"
        onChange={(event) => {
          uploadStructures(event.target.files);
          event.target.value = "";
        }}
      />
      <input
        ref={pmlInputRef}
        type="file"
        hidden
        accept=".pml,.txt"
        onChange={(event) => {
          importPml(event.target.files?.[0]);
          event.target.value = "";
        }}
      />
    </div>
  );
}

function HistoryColumn({
  workspace,
  selectedVersion,
  busy,
  onPreview,
  onRestore
}) {
  return (
    <aside className="history-column">
      <div className="column-title">
        <div>
          <History size={16} />
          <strong>历史记录</strong>
        </div>
        <span>{workspace.versions.length}</span>
      </div>
      <div className="history-help">每次 AI 和人工修改都会留下一个可恢复节点。</div>
      <div className="simple-timeline">
        {workspace.versions.map((version) => {
          const current = version.id === workspace.version.id;
          const selected = version.id === selectedVersion?.id;
          return (
            <article
              key={version.id}
              className={`timeline-node ${selected ? "selected" : ""}`}
              onClick={() => onPreview(version.id)}
            >
              <span className={`timeline-dot actor-${version.actor}`}>
                {version.actor === "ai" ? (
                  <Sparkles size={11} />
                ) : version.actor === "human" ? (
                  <UserRound size={11} />
                ) : (
                  <Clock3 size={11} />
                )}
              </span>
              <div className="timeline-card">
                <div className="timeline-meta">
                  <span>版本 {version.revision}</span>
                  <time>{formatTime(version.createdAt)}</time>
                </div>
                <strong>{friendlySummary(version.summary)}</strong>
                <div className="timeline-footer">
                  <span>{actorLabel(version.actor)}</span>
                  {current ? (
                    <em>当前</em>
                  ) : (
                    <button
                      disabled={Boolean(busy)}
                      onClick={(event) => {
                        event.stopPropagation();
                        onRestore(version.id);
                      }}
                    >
                      {busy === `restore:${version.id}` ? (
                        <LoaderCircle size={11} className="spin" />
                      ) : (
                        <Undo2 size={11} />
                      )}
                      恢复
                    </button>
                  )}
                </div>
              </div>
            </article>
          );
        })}
      </div>
    </aside>
  );
}

function ConversationColumn({
  workspace,
  busy,
  chatInput,
  setChatInput,
  onSubmit,
  onPreview,
  versions,
  structureInputRef,
  chatEndRef,
  t,
  language
}) {
  const [showSkills, setShowSkills] = useState(false);
  const versionMap = useMemo(
    () => new Map(versions.map((version) => [version.id, version])),
    [versions]
  );
  return (
    <section className="conversation-column">
      <div className="column-title">
        <div>
          <MessageSquare size={16} />
          <strong>{t("对话")}</strong>
        </div>
        <span className="online-dot">{t("AI 协作")}</span>
      </div>
      <div className="simple-chat">
        {workspace.messages.map((message) => {
          const linkedVersion = versionMap.get(message.versionId);
          return (
            <div
              className={`simple-message ${
                message.role === "assistant" ? "from-ai" : "from-user"
              }`}
              key={message.id}
            >
              <div className="message-avatar">
                {message.role === "assistant" ? (
                  <Bot size={14} />
                ) : (
                  <UserRound size={14} />
                )}
              </div>
              <div className="message-body">
                <div className="message-name">
                  <strong>{message.role === "assistant" ? t("场景 AI") : t("你")}</strong>
                  <time>{formatTime(message.createdAt, language)}</time>
                </div>
                <p>{message.mode === "system" ? t(message.content) : message.content}</p>
                {message.skills?.length > 0 && (
                  <div className="message-skills">
                    <ShieldCheck size={12} />
                    {message.skills.map((skill) => (
                      <span key={skill.id}>{t(skill.title)}</span>
                    ))}
                  </div>
                )}
                {linkedVersion && (
                  <button
                    className="change-card"
                    onClick={() => onPreview(linkedVersion.id)}
                  >
                    <span className="change-icon">
                      <Box size={15} />
                    </span>
                    <span>
                      <small>{t("场景修改")} · {t("版本")} {linkedVersion.revision}</small>
                      <strong>{friendlySummary(linkedVersion.summary, t)}</strong>
                      <em>{t("点击查看当时的结构与 PML")}</em>
                    </span>
                    <ChevronRight size={15} />
                  </button>
                )}
              </div>
            </div>
          );
        })}
        {busy === "ai" && (
          <div className="simple-message from-ai">
            <div className="message-avatar">
              <Bot size={14} />
            </div>
            <div className="message-body ai-thinking">
              <i />
              <i />
              <i />
            </div>
          </div>
        )}
        <div ref={chatEndRef} />
      </div>
      <div className="skill-switcher">
        <button onClick={() => setShowSkills((value) => !value)}>
          <ShieldCheck size={13} />
          {t("Skills 自动匹配")}
        </button>
        <span>{t("生成后执行安全校验")}</span>
        {showSkills && (
          <div className="skill-popover">
            <strong>{t("已启用的分子可视化 Skills")}</strong>
            <p>{t("系统会根据指令自动选择，并始终加载“安全 PML”。")}</p>
            <div>{SKILL_LABELS.map((label) => <span key={label}>{t(label)}</span>)}</div>
          </div>
        )}
      </div>
      <div className="prompt-chips">
        <button onClick={() => setChatInput(language === "en" ? "Show the structure as cartoon and color by chain" : "把蛋白显示为卡通并按链着色")}>
          {t("按链着色")}
        </button>
        <button onClick={() => setChatInput(language === "en" ? "Show the ligand and its pocket within 5 Å" : "显示配体和周围 5 Å 的口袋")}>
          {t("配体口袋")}
        </button>
        <button onClick={() => setChatInput(language === "en" ? "Create a publication-ready view on a white background" : "制作白底、适合论文的视图")}>
          {t("论文视图")}
        </button>
      </div>
      <form className="simple-composer" onSubmit={onSubmit}>
        <textarea
          value={chatInput}
          onChange={(event) => setChatInput(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              onSubmit(event);
            }
          }}
          placeholder={t("描述你想怎样修改场景…")}
          rows={3}
        />
        <div>
          <button
            type="button"
            className="attach-button"
            onClick={() => structureInputRef.current?.click()}
            title={t("上传结构")}
          >
            <Paperclip size={15} />
          </button>
          <span>{t("Enter 发送 · Shift + Enter 换行")}</span>
          <button
            className="simple-send"
            disabled={!chatInput.trim() || Boolean(busy)}
            aria-label={t("发送")}
          >
            {busy === "ai" ? (
              <LoaderCircle size={15} className="spin" />
            ) : (
              <Send size={15} />
            )}
          </button>
        </div>
      </form>
    </section>
  );
}

function RightTabs({ value, onChange, t }) {
  const tabs = [
    { id: "scene", label: "PyMOL", icon: Box },
    { id: "pml", label: "PML 文件", icon: Code2 },
    { id: "files", label: "文件与下载", icon: FileBox }
  ];
  return (
    <nav className="right-tabs">
      {tabs.map((tab) => {
        const Icon = tab.icon;
        return (
          <button
            key={tab.id}
            className={value === tab.id ? "active" : ""}
            onClick={() => onChange(tab.id)}
          >
            <Icon size={14} />
            {t(tab.label)}
          </button>
        );
      })}
    </nav>
  );
}

function FilesPane({
  workspace,
  api,
  busy,
  pdbId,
  setPdbId,
  onFetch,
  onUpload,
  onImport,
  t
}) {
  return (
    <div className="files-pane">
      <section className="file-section">
        <div className="section-heading">
          <div>
            <Database size={15} />
            <strong>{t("获取蛋白")}</strong>
          </div>
          <span>{t("上传本地文件，或从 RCSB 自动下载")}</span>
        </div>
        <div className="file-actions">
          <button className="upload-tile" onClick={onUpload}>
            <Upload size={18} />
            <span>
              <strong>{t("上传结构")}</strong>
              <small>{t("PDB、mmCIF 等")}</small>
            </span>
          </button>
          <div className="pdb-download">
            <input
              value={pdbId}
              onChange={(event) =>
                setPdbId(event.target.value.toUpperCase().slice(0, 4))
              }
              onKeyDown={(event) => {
                if (event.key === "Enter") onFetch();
              }}
              placeholder={t("PDB ID，例如 1UBQ")}
            />
            <button
              onClick={() => onFetch()}
              disabled={pdbId.length !== 4 || Boolean(busy)}
            >
              {busy === `fetch:${pdbId}` ? (
                <LoaderCircle size={14} className="spin" />
              ) : (
                <Download size={14} />
              )}
              {t("下载")}
            </button>
          </div>
        </div>
        <div className="example-row">
          <span>{t("快速示例")}</span>
          {EXAMPLES.map((item) => (
            <button
              key={item.id}
              disabled={Boolean(busy)}
              onClick={() => onFetch(item.id)}
            >
              {t(item.label)}
              <code>{item.id}</code>
            </button>
          ))}
        </div>
      </section>

      <section className="file-section structures-section">
        <div className="section-heading">
          <div>
            <FileBox size={15} />
            <strong>{t("场景文件")}</strong>
          </div>
          <span>{workspace.structures.length} {t("个结构")}</span>
        </div>
        <div className="simple-file-list">
          {workspace.structures.length ? (
            workspace.structures.map((structure) => (
              <div className="simple-file-row" key={structure.id}>
                <span className="file-type">{structure.format.toUpperCase()}</span>
                <div>
                  <strong>{structure.filename}</strong>
                  <small>
                    {t("对象")} {structure.objectName} · {formatBytes(structure.bytes)}
                  </small>
                </div>
                <button
                  title={t("下载结构")}
                  onClick={() =>
                    api.downloadStructure(workspace.project.id, structure)
                  }
                >
                  <Download size={14} />
                </button>
              </div>
            ))
          ) : (
            <div className="files-empty">{t("还没有结构文件")}</div>
          )}
        </div>
      </section>

      <section className="file-section export-section">
        <div className="section-heading">
          <div>
            <Archive size={15} />
            <strong>{t("导出")}</strong>
          </div>
          <span>{t("下载后可在本地继续使用")}</span>
        </div>
        <div className="export-buttons">
          <button
            onClick={() =>
              api.downloadPml(workspace.project.id, workspace.project.title)
            }
          >
            <FileCode2 size={16} />
            <span>
              <strong>{t("导出 PML")}</strong>
              <small>{t("当前可编辑脚本")}</small>
            </span>
          </button>
          <button
            onClick={() =>
              api.downloadProject(workspace.project.id, workspace.project.title)
            }
          >
            <Archive size={16} />
            <span>
              <strong>{t("导出完整项目")}</strong>
              <small>{t("PML、结构、对话和版本记录")}</small>
            </span>
          </button>
          <button onClick={onImport}>
            <Upload size={16} />
            <span>
              <strong>{t("导入 PML")}</strong>
              <small>{t("作为新的可追溯版本")}</small>
            </span>
          </button>
        </div>
      </section>
    </div>
  );
}

function ResizeHandle({ side, label, onPointerDown }) {
  return (
    <div
      className={`resize-handle resize-${side}`}
      role="separator"
      aria-orientation="vertical"
      aria-label={label}
      onPointerDown={onPointerDown}
    >
      <i />
    </div>
  );
}

function LineNumbers({ value }) {
  return (
    <pre aria-hidden="true">
      {Array.from({ length: value.split("\n").length }, (_, index) => index + 1).join(
        "\n"
      )}
    </pre>
  );
}

function Mark() {
  return (
    <span className="simple-mark" aria-hidden="true">
      <span />
      <span />
      <span />
    </span>
  );
}

function structuresInVersion(pml, structures) {
  if (!structures.length) return [];
  return structures.filter(
    (item) =>
      pml.includes(`# @chatpymol structure=${item.id}`) ||
      pml.includes(`load ${item.filename}`) ||
      pml.includes(`load "${item.filename}"`)
  );
}

function actorLabel(actor) {
  if (actor === "ai") return "AI 修改";
  if (actor === "human") return "人工修改";
  return "系统";
}

function friendlySummary(summary, t = (value) => value) {
  const normalized = String(summary || "场景修改")
    .replace(/^Created the initial scene$/i, "创建初始场景")
    .replace(/^Uploaded /i, "上传 ")
    .replace(/^Imported /i, "导入 ")
    .replace(/^Restored revision (\d+)$/i, "恢复到版本 $1")
    .replace(/^Edited PML$/i, "人工编辑 PML");
  return t(normalized);
}

function formatTime(value, language = "zh") {
  return new Date(value).toLocaleString(language === "en" ? "en-US" : "zh-CN", {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  });
}

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
