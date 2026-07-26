import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Atom,
  Bot,
  Box,
  Check,
  ChevronDown,
  Clock3,
  Code2,
  Database,
  Download,
  FileCode2,
  FileUp,
  History,
  Layers3,
  LoaderCircle,
  MessageSquareText,
  MoreHorizontal,
  Paperclip,
  Play,
  Redo2,
  RotateCcw,
  Save,
  Send,
  Sparkles,
  Upload,
  UserRound,
  WandSparkles
} from "lucide-react";
import { ApiClient, getDeviceToken } from "./api";
import { MolecularViewer } from "./components/MolecularViewer";
import { StructureHub } from "./components/StructureHub";
import { UseCases } from "./components/UseCases";

const QUICK_ACTIONS = [
  { label: "卡通", command: "show cartoon" },
  { label: "表面", command: "show surface" },
  { label: "配体", command: "select ligand, organic\nshow sticks, ligand\nzoom ligand" },
  { label: "白色背景", command: "bg_color white" }
];

export function App() {
  const token = useMemo(getDeviceToken, []);
  const api = useMemo(() => new ApiClient(token), [token]);
  const [workspace, setWorkspace] = useState(null);
  const [editorPml, setEditorPml] = useState("");
  const [chatInput, setChatInput] = useState("");
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [rightTab, setRightTab] = useState("pml");
  const [consoleLines, setConsoleLines] = useState([]);
  const [savedPulse, setSavedPulse] = useState(false);
  const [showStructureHub, setShowStructureHub] = useState(false);
  const [showUseCases, setShowUseCases] = useState(false);
  const chatEndRef = useRef(null);
  const structureInputRef = useRef(null);
  const pmlInputRef = useRef(null);

  const applyWorkspace = useCallback((next) => {
    setWorkspace(next);
    setEditorPml(next.pml);
    setError("");
  }, []);

  useEffect(() => {
    api.bootstrap().then(applyWorkspace).catch((reason) => setError(reason.message));
  }, [api, applyWorkspace]);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [workspace?.messages?.length, busy]);

  const isDirty = workspace ? editorPml !== workspace.pml : false;

  const reloadAfterConflict = useCallback(
    async (reason) => {
      if (reason.status === 409 && workspace) {
        const fresh = await api.getProject(workspace.project.id);
        applyWorkspace(fresh);
        setError("场景已被另一轮修改更新，已载入最新版本，请重新应用你的编辑。");
        return true;
      }
      return false;
    },
    [api, applyWorkspace, workspace]
  );

  const savePml = useCallback(
    async (summary = "Edited PML") => {
      if (!workspace || !isDirty) return;
      setBusy("save");
      setError("");
      try {
        const result = await api.savePml(
          workspace.project.id,
          editorPml,
          workspace.version.id,
          summary
        );
        applyWorkspace(result.workspace);
        setSavedPulse(true);
        setTimeout(() => setSavedPulse(false), 1200);
      } catch (reason) {
        if (!(await reloadAfterConflict(reason))) setError(reason.message);
      } finally {
        setBusy("");
      }
    },
    [api, applyWorkspace, editorPml, isDirty, reloadAfterConflict, workspace]
  );

  useEffect(() => {
    const onKeyDown = (event) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "s") {
        event.preventDefault();
        savePml();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [savePml]);

  async function sendMessage(event) {
    event?.preventDefault();
    const message = chatInput.trim();
    if (!message || !workspace || busy) return;
    setChatInput("");
    setBusy("ai");
    setError("");
    const optimistic = {
      ...workspace,
      messages: [
        ...workspace.messages,
        {
          id: `optimistic-${Date.now()}`,
          role: "user",
          content: message,
          createdAt: new Date().toISOString()
        }
      ]
    };
    setWorkspace(optimistic);
    try {
      const result = await api.askAi(
        workspace.project.id,
        message,
        workspace.version.id
      );
      applyWorkspace(result.workspace);
    } catch (reason) {
      if (!(await reloadAfterConflict(reason))) {
        setWorkspace(workspace);
        setError(reason.message);
      }
    } finally {
      setBusy("");
    }
  }

  async function uploadStructures(files) {
    if (!files?.length || !workspace) return;
    setBusy("upload");
    setError("");
    try {
      const result = await api.uploadStructures(workspace.project.id, files);
      applyWorkspace(result.workspace);
    } catch (reason) {
      setError(reason.message);
    } finally {
      setBusy("");
    }
  }

  async function importPml(file) {
    if (!file || !workspace) return;
    setBusy("upload");
    setError("");
    try {
      const result = await api.importPml(
        workspace.project.id,
        file,
        workspace.version.id
      );
      applyWorkspace(result.workspace);
    } catch (reason) {
      if (!(await reloadAfterConflict(reason))) setError(reason.message);
    } finally {
      setBusy("");
    }
  }

  async function restoreVersion(versionId) {
    if (!workspace || busy) return;
    setBusy("restore");
    try {
      const result = await api.restore(
        workspace.project.id,
        versionId,
        workspace.version.id
      );
      applyWorkspace(result.workspace);
    } catch (reason) {
      if (!(await reloadAfterConflict(reason))) setError(reason.message);
    } finally {
      setBusy("");
    }
  }

  function appendCommand(command, label) {
    const next = `${editorPml.trimEnd()}\n\n# Human action: ${label}\n${command}\n`;
    setEditorPml(next);
  }

  const onViewerOutput = useCallback((message) => {
    setConsoleLines((lines) =>
      [...lines, { ...message, at: new Date().toLocaleTimeString() }].slice(-40)
    );
  }, []);

  if (!workspace) {
    return (
      <main className="boot-screen">
        <Logo />
        <div className="boot-loader">
          <LoaderCircle className="spin" size={18} />
          正在打开分子工作台
        </div>
        {error && <div className="global-error">{error}</div>}
      </main>
    );
  }

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="brand">
          <Logo />
          <div>
            <strong>ChatPyMOL</strong>
            <span>AI 与人协同的分子工作台</span>
          </div>
        </div>
        <div className="scene-title">
          <span className="scene-dot" />
          <div>
            <strong>{workspace.project.title}</strong>
            <small>
              版本 {workspace.version.revision} ·{" "}
              {workspace.structures.length} 个结构

            </small>
          </div>
          <ChevronDown size={15} />
        </div>
        <div className="top-actions">
          <div className="identity-chip" title={`设备标识：${token}`}>
            <span>匿名设备</span>
            <code>{token.slice(-6)}</code>
          </div>
          <button
            className="button ghost"
            onClick={() => api.downloadProject(workspace.project.id, workspace.project.title)}
          >
            <Download size={15} />
            导出项目
          </button>
          <button className="icon-button" aria-label="更多选项">
            <MoreHorizontal size={18} />
          </button>
        </div>
      </header>

      {error && (
        <div className="global-error">
          <span>{error}</span>
          <button onClick={() => setError("")}>关闭</button>
        </div>
      )}

      <main className="workspace-grid">
        <aside className="chat-panel panel">
          <div className="panel-heading">
            <div>
              <span className="eyebrow">协作助手</span>
              <h2>
                <MessageSquareText size={17} />
                场景对话
              </h2>
            </div>
            <span className="mode-chip">
              <Sparkles size={12} />
              {workspace.messages.some((item) => item.mode === "openai")
                ? "AI 已连接"
                : "本地模式"}
            </span>
          </div>

          <div className="chat-scroll">
            <div className="chat-date">今天</div>
            {workspace.messages.map((message) => (
              <ChatMessage key={message.id} message={message} />
            ))}
            {busy === "ai" && (
              <div className="message assistant-message thinking">
                <div className="avatar ai-avatar">
                  <Bot size={15} />
                </div>
                <div>
                  <span className="message-author">场景 AI</span>
                  <div className="typing-dots">
                    <i />
                    <i />
                    <i />
                  </div>
                </div>
              </div>
            )}
            <div ref={chatEndRef} />
          </div>

          <div className="quick-prompts">
            <button onClick={() => setChatInput("突出显示配体周围 5 Å 的结合口袋")}>
              显示结合口袋
            </button>
            <button onClick={() => setChatInput("制作白色背景的论文级 cartoon 视图")}>
              论文级视图
            </button>
          </div>

          <form className="chat-composer" onSubmit={sendMessage}>
            <textarea
              value={chatInput}
              onChange={(event) => setChatInput(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.shiftKey) {
                  event.preventDefault();
                  sendMessage();
                }
              }}
              placeholder="告诉 AI 你想怎样调整当前场景…"
              rows={3}
            />
            <div className="composer-footer">
              <button
                type="button"
                className="icon-button compact"
                onClick={() => structureInputRef.current?.click()}
                aria-label="上传结构"
              >
                <Paperclip size={16} />
              </button>
              <span>Enter 发送 · Shift + Enter 换行</span>
              <button
                className="send-button"
                disabled={!chatInput.trim() || Boolean(busy)}
                aria-label="发送"
              >
                {busy === "ai" ? (
                  <LoaderCircle size={16} className="spin" />
                ) : (
                  <Send size={16} />
                )}
              </button>
            </div>
          </form>
        </aside>

        <section className="viewer-panel panel">
          <div className="viewer-toolbar">
            <div className="tool-group">
              <span>表现形式</span>
              {QUICK_ACTIONS.map((action) => (
                <button
                  key={action.label}
                  onClick={() => appendCommand(action.command, action.label)}
                >
                  {action.label}
                </button>
              ))}
            </div>
            <div className="toolbar-separator" />
            <div className="tool-group icon-tools">
              <button title="居中并调整视角" onClick={() => appendCommand("orient", "调整视角")}>
                <RotateCcw size={15} />
              </button>
              <button title="在版本历史中撤销" onClick={() => setRightTab("history")}>
                <History size={15} />
              </button>
              <button title="重做">
                <Redo2 size={15} />
              </button>
            </div>
            <button
              className={`render-button ${isDirty ? "dirty" : ""}`}
              disabled={!isDirty || Boolean(busy)}
              onClick={() => savePml("Applied human scene edits")}
            >
              {busy === "save" ? (
                <LoaderCircle size={15} className="spin" />
              ) : savedPulse ? (
                <Check size={15} />
              ) : (
                <Play size={15} />
              )}
              {savedPulse ? "已保存" : isDirty ? "保存并渲染" : "场景已保存"}
            </button>
          </div>

          <MolecularViewer
            api={api}
            projectId={workspace.project.id}
            pml={workspace.pml}
            structures={workspace.structures}
            versionId={workspace.version.id}
            onOutput={onViewerOutput}
            onUpload={() => structureInputRef.current?.click()}
            onExamples={() => setShowUseCases(true)}
          />

          <div className="asset-shelf">
            <div className="asset-heading">
              <span>
                <Layers3 size={14} />
                场景对象
              </span>
              <button onClick={() => setShowUseCases(true)}>
                <Sparkles size={14} />
                示例玩法
              </button>
              <button onClick={() => setShowStructureHub(true)}>
                <Database size={14} />
                蛋白库 / 合并
              </button>
              <button onClick={() => structureInputRef.current?.click()}>
                <Upload size={14} />
                上传结构
              </button>
            </div>
            <div className="asset-list">
              {workspace.structures.length === 0 ? (
                <button
                  className="empty-asset"
                  onClick={() => structureInputRef.current?.click()}
                >
                  <FileUp size={18} />
                  <span>
                    <strong>上传 PDB 或 mmCIF</strong>
                    文件将保存在服务器，并与场景版本关联。
                  </span>
                </button>
              ) : (
                workspace.structures.map((structure, index) => (
                  <div className="asset-row" key={structure.id}>
                    <div className={`asset-swatch swatch-${index % 5}`}>
                      <Atom size={15} />
                    </div>
                    <div>
                      <strong>{structure.objectName}</strong>
                      <span>
                        {structure.format.toUpperCase()} · {formatBytes(structure.bytes)}
                      </span>
                    </div>
                    <button
                      title={`下载 ${structure.filename}`}
                      onClick={() =>
                        api.downloadStructure(workspace.project.id, structure)
                      }
                    >
                      <Download size={14} />
                    </button>
                  </div>
                ))
              )}
            </div>
          </div>
        </section>

        <aside className="editor-panel panel">
          <div className="editor-tabs">
            <button
              className={rightTab === "pml" ? "active" : ""}
              onClick={() => setRightTab("pml")}
            >
              <Code2 size={15} />
              PML
              {isDirty && <i className="dirty-dot" />}
            </button>
            <button
              className={rightTab === "history" ? "active" : ""}
              onClick={() => setRightTab("history")}
            >
              <Clock3 size={15} />
              版本
              <span>{workspace.versions.length}</span>
            </button>
          </div>

          {rightTab === "pml" ? (
            <>
              <div className="editor-meta">
                <span>
                  <FileCode2 size={14} />
                  scene.pml
                </span>
                <div>
                  <button onClick={() => pmlInputRef.current?.click()}>
                    <Upload size={14} /> 导入
                  </button>
                  <button
                    onClick={() =>
                      api.downloadPml(
                        workspace.project.id,
                        workspace.project.title
                      )
                    }
                  >
                    <Download size={14} /> 导出 PML
                  </button>
                </div>
              </div>
              <div className="code-editor">
                <LineNumbers value={editorPml} />
                <textarea
                  value={editorPml}
                  onChange={(event) => setEditorPml(event.target.value)}
                  spellCheck="false"
                  aria-label="PML 编辑器"
                />
              </div>
              <div className="editor-footer">
                <span>{editorPml.split("\n").length} 行</span>
                <span>{isDirty ? "人工编辑尚未保存" : "已同步到事件记录"}</span>
                <button
                  disabled={!isDirty || Boolean(busy)}
                  onClick={() => savePml()}
                >
                  <Save size={14} />
                  Save
                </button>
              </div>
              <div className="console">
                <div className="console-heading">
                  <span>渲染器输出</span>
                  <button onClick={() => setConsoleLines([])}>清空</button>
                </div>
                <div className="console-body">
                  {consoleLines.length === 0 ? (
                    <span className="console-empty">
                      已就绪，渲染消息会显示在这里。
                    </span>
                  ) : (
                    consoleLines.map((line, index) => (
                      <div key={`${line.at}-${index}`} className={`log-${line.level}`}>
                        <time>{line.at}</time>
                        <span>{line.text}</span>
                      </div>
                    ))
                  )}
                </div>
              </div>
            </>
          ) : (
            <HistoryPanel
              versions={workspace.versions}
              activeVersionId={workspace.version.id}
              onRestore={restoreVersion}
              busy={busy === "restore"}
            />
          )}
        </aside>
      </main>

      <UseCases
        open={showUseCases}
        onClose={() => setShowUseCases(false)}
        api={api}
        workspace={workspace}
        onWorkspace={applyWorkspace}
        onError={setError}
      />

      <StructureHub
        open={showStructureHub}
        onClose={() => setShowStructureHub(false)}
        api={api}
        workspace={workspace}
        onWorkspace={applyWorkspace}
        onError={setError}
      />

      <input
        ref={structureInputRef}
        type="file"
        multiple
        hidden
        accept=".pdb,.ent,.cif,.mmcif,.bcif,.mol2,.sdf,.mol,.xyz,.gro,.mrc,.ccp4,.xtc,.trr"
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

function Logo() {
  return (
    <div className="logo-mark" aria-label="ChatPyMOL">
      <svg viewBox="0 0 40 40" role="img">
        <path d="M11 6c7 2 11 7 18 10M9 16c8 2 12 7 22 9M10 27c7 1 12 5 19 8" />
        <path d="M29 5c-2 8-7 12-17 16M31 15c-4 8-8 11-21 15M28 27c-4 4-8 6-16 8" />
        <circle cx="10" cy="6" r="2.4" />
        <circle cx="30" cy="5" r="2.4" />
        <circle cx="9" cy="16" r="2.4" />
        <circle cx="31" cy="15" r="2.4" />
        <circle cx="10" cy="28" r="2.4" />
        <circle cx="29" cy="27" r="2.4" />
        <circle cx="12" cy="35" r="2.4" />
        <circle cx="29" cy="35" r="2.4" />
      </svg>
    </div>
  );
}

function ChatMessage({ message }) {
  const isAssistant = message.role === "assistant";
  return (
    <div className={`message ${isAssistant ? "assistant-message" : "user-message"}`}>
      <div className={`avatar ${isAssistant ? "ai-avatar" : "user-avatar"}`}>
        {isAssistant ? <Bot size={15} /> : <UserRound size={14} />}
      </div>
      <div className="message-content">
        <div className="message-line">
          <span className="message-author">
            {isAssistant ? "场景 AI" : "你"}
          </span>
          <time>{formatTime(message.createdAt)}</time>
        </div>
        <p>{message.content}</p>
        {message.versionId && (
          <span className="commit-chip">
            <WandSparkles size={11} />
            已提交 {message.versionId.slice(0, 8)}
          </span>
        )}
      </div>
    </div>
  );
}

function HistoryPanel({ versions, activeVersionId, onRestore, busy }) {
  return (
    <div className="history-panel">
      <div className="history-intro">
        <History size={18} />
        <div>
          <strong>场景时间线</strong>
          <span>每次 AI 与人工编辑都会保存为不可变版本。</span>
        </div>
      </div>
      <div className="history-list">
        {versions.map((version) => {
          const active = version.id === activeVersionId;
          return (
            <div className={`history-item ${active ? "active" : ""}`} key={version.id}>
              <div className="history-node">
                {version.actor === "ai" ? <Sparkles size={12} /> : <UserRound size={12} />}
              </div>
              <div className="history-copy">
                <div>
                  <strong>{version.summary}</strong>
                  <span>r{version.revision}</span>
                </div>
                <p>
                  {version.actor === "ai" ? "AI" : version.actor === "human" ? "人工" : "系统"} · {formatTime(version.createdAt)}
                </p>
                <code>{version.sha256.slice(0, 9)}</code>
              </div>
              {active ? (
                <span className="current-chip">当前</span>
              ) : (
                <button disabled={busy} onClick={() => onRestore(version.id)}>
                  恢复
                </button>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function LineNumbers({ value }) {
  const count = value.split("\n").length;
  return (
    <pre className="line-numbers" aria-hidden="true">
      {Array.from({ length: count }, (_, index) => index + 1).join("\n")}
    </pre>
  );
}

function formatTime(value) {
  if (!value) return "";
  return new Date(value).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit"
  });
}

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
