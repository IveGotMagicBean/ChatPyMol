import {
  Bot,
  Check,
  ChevronRight,
  Copy,
  FileBox,
  Github,
  History,
  Languages,
  LoaderCircle,
  Mail,
  Menu,
  MessageSquarePlus,
  Moon,
  MoreHorizontal,
  PanelRight,
  Paperclip,
  Pencil,
  Pin,
  PinOff,
  Plus,
  Send,
  Sun,
  SquareTerminal,
  Trash2,
  X
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ApiClient, getDeviceToken } from "./api";
import { NativePyMOLViewer } from "./components/NativePyMOLViewer";
import { createTranslator } from "./i18n";
import { rebaseNativePmlDraft } from "./pml-rebase";

const GITHUB_URL = "https://github.com/IveGotMagicBean/ChatPyMol";
const ISSUE_URL =
  "https://github.com/IveGotMagicBean/ChatPyMol/issues/new?template=suggestion.yml";
const EMAIL_URL = "mailto:542058929@qq.com";
const CODEX_GUIDE_URL =
  "https://github.com/IveGotMagicBean/ChatPyMol/blob/main/docs/cli-codex-claude.zh-CN.md";
const CODEX_INSTALL_PROMPT_ZH = `请帮我安装并连接 ChatPyMOL 的 Codex 插件。

项目仓库：https://github.com/IveGotMagicBean/ChatPyMol

请先阅读仓库中的 docs/cli-codex-claude.zh-CN.md，然后按以下要求操作：
1. 在安全的本地目录克隆或更新仓库，并确认 Node.js 版本不低于 22；
2. 在仓库根目录运行 npm ci --ignore-scripts、npm run build 和 npm install -g .；
3. 询问我的 ChatPyMOL 服务地址，再运行 chatpymol pair --base-url <服务地址>。需要浏览器确认时暂停，把配对链接交给我；不要输出、记录或提交匿名工作区令牌；
4. 在仓库根目录运行 codex plugin marketplace add "$PWD/integrations/codex" 和 codex plugin add chatpymol@chatpymol-local；
5. 使用 chatpymol status、codex plugin list 和 codex mcp list 验证安装结果；
6. 完成后提醒我重启 Codex，并在新会话中使用 /mcp 确认 chatpymol 已连接。

不要修改任何蛋白场景，除非我随后明确提出修改要求。`;
const CODEX_INSTALL_PROMPT_EN = `Help me install and connect the ChatPyMOL plugin for Codex.

Repository: https://github.com/IveGotMagicBean/ChatPyMol

Read docs/cli-codex-claude.zh-CN.md in the repository first, then:
1. Clone or update the repository in a safe local directory and verify Node.js 22 or newer;
2. From the repository root, run npm ci --ignore-scripts, npm run build, and npm install -g .;
3. Ask me for my ChatPyMOL service URL, then run chatpymol pair --base-url <service-url>. Pause when browser confirmation is required and give me the pairing link. Never print, log, or commit the anonymous workspace token;
4. From the repository root, run codex plugin marketplace add "$PWD/integrations/codex" and codex plugin add chatpymol@chatpymol-local;
5. Verify the setup with chatpymol status, codex plugin list, and codex mcp list;
6. Remind me to restart Codex, then use /mcp in a new session to confirm that chatpymol is connected.

Do not modify any molecular scene unless I explicitly ask you to do so afterward.`;
const CONVERSATION_MENU_WIDTH = 145;
const CONVERSATION_MENU_HEIGHT = 108;
const CONVERSATION_MENU_GAP = 4;
const CONVERSATION_MENU_MARGIN = 8;
const NATIVE_AUTO_SAVE_DELAY_MS = 1400;
const NATIVE_AUTO_SAVE_ATTEMPTS = 3;
const EXTERNAL_SYNC_DEBOUNCE_MS = 260;
const EXTERNAL_SYNC_RETRY_MS = 700;
const MANAGED_VIEW_RE =
  /\n*# @chatpymol view-begin[\s\S]*?# @chatpymol view-end\n?/g;

export function AppClean() {
  const token = useMemo(getDeviceToken, []);
  const api = useMemo(() => new ApiClient(token), [token]);
  const [workspace, setWorkspace] = useState(null);
  const [conversations, setConversations] = useState([]);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [autoSaveStatus, setAutoSaveStatus] = useState("idle");
  const [autoSaveError, setAutoSaveError] = useState("");
  const [chatInput, setChatInput] = useState("");
  const [theme, setTheme] = useState(
    () =>
      localStorage.getItem("chatpymol.theme") ||
      (window.matchMedia?.("(prefers-color-scheme: dark)").matches
        ? "dark"
        : "light")
  );
  const [language, setLanguage] = useState(
    () => localStorage.getItem("chatpymol.language") || "zh"
  );
  const [leftWidth, setLeftWidth] = useState(
    () => Number(localStorage.getItem("chatpymol.left-width")) || 260
  );
  const [rightWidth, setRightWidth] = useState(
    () => {
      const stored = Number(localStorage.getItem("chatpymol.right-width"));
      return Math.min(900, Math.max(440, stored || 620));
    }
  );
  const [leftCollapsed, setLeftCollapsed] = useState(false);
  const [rightCollapsed, setRightCollapsed] = useState(false);
  const [selectedStructureId, setSelectedStructureId] = useState(null);
  const [editorPml, setEditorPml] = useState("");
  const [renderPml, setRenderPml] = useState("");
  const [draftTimeline, setDraftTimeline] = useState({
    states: [""],
    index: 0
  });
  const [previewVersion, setPreviewVersion] = useState(null);
  const [unreadProjectIds, setUnreadProjectIds] = useState(() => new Set());
  const [menuId, setMenuId] = useState(null);
  const [menuPosition, setMenuPosition] = useState({ top: 0, left: 0 });
  const [editingId, setEditingId] = useState(null);
  const [titleDraft, setTitleDraft] = useState("");
  const [emailPopoverOpen, setEmailPopoverOpen] = useState(false);
  const [emailCopyStatus, setEmailCopyStatus] = useState("idle");
  const [codexDialogOpen, setCodexDialogOpen] = useState(false);
  const [codexCopyStatus, setCodexCopyStatus] = useState("idle");
  const chatEndRef = useRef(null);
  const fileInputRef = useRef(null);
  const renderTimerRef = useRef(null);
  const autoSaveTimerRef = useRef(null);
  const saveInFlightRef = useRef(null);
  const nativeConflictRef = useRef(null);
  const flushNativeDraftRef = useRef(null);
  const busyRef = useRef("");
  const autoSaveStatusRef = useRef("idle");
  const workspaceRef = useRef(null);
  const previewVersionRef = useRef(null);
  const editorPmlRef = useRef("");
  const draftGenerationRef = useRef(0);
  const conversationMenuRef = useRef(null);
  const conversationMenuTriggerRef = useRef(null);
  const externalSyncTimerRef = useRef(null);
  const externalSyncInFlightRef = useRef(false);
  const queuedExternalUpdateRef = useRef(null);
  const scheduleExternalSyncRef = useRef(null);
  const pairCompletionCodeRef = useRef(null);
  const emailPopoverRef = useRef(null);
  const emailTriggerRef = useRef(null);
  const emailCopyButtonRef = useRef(null);
  const emailCopyTimerRef = useRef(null);
  const codexCopyButtonRef = useRef(null);
  const codexCopyTimerRef = useRef(null);
  const t = useMemo(() => createTranslator(language), [language]);
  const codexInstallPrompt =
    language === "en" ? CODEX_INSTALL_PROMPT_EN : CODEX_INSTALL_PROMPT_ZH;
  function toggleConversationMenu(conversationId, event) {
    if (menuId === conversationId) {
      setMenuId(null);
      return;
    }

    const trigger = event.currentTarget;
    const rect = trigger.getBoundingClientRect();
    const below = rect.bottom + CONVERSATION_MENU_GAP;
    const above =
      rect.top - CONVERSATION_MENU_HEIGHT - CONVERSATION_MENU_GAP;
    const top =
      below + CONVERSATION_MENU_HEIGHT <=
      window.innerHeight - CONVERSATION_MENU_MARGIN
        ? below
        : Math.max(CONVERSATION_MENU_MARGIN, above);
    const left = Math.min(
      window.innerWidth -
        CONVERSATION_MENU_WIDTH -
        CONVERSATION_MENU_MARGIN,
      Math.max(
        CONVERSATION_MENU_MARGIN,
        rect.right - CONVERSATION_MENU_WIDTH
      )
    );

    conversationMenuTriggerRef.current = trigger;
    setMenuPosition({ top, left });
    setMenuId(conversationId);
  }
  const menuConversation = conversations.find(
    (conversation) => conversation.id === menuId
  );

  const refreshConversations = useCallback(() => {
    api
      .listProjects()
      .then((result) => setConversations(result.projects))
      .catch(() => {});
  }, [api]);

  const resetDraft = useCallback((pml, { saveStatus = "idle" } = {}) => {
    const value = String(pml || "");
    window.clearTimeout(renderTimerRef.current);
    window.clearTimeout(autoSaveTimerRef.current);
    editorPmlRef.current = value;
    nativeConflictRef.current = null;
    draftGenerationRef.current += 1;
    setEditorPml(value);
    setRenderPml(value);
    setDraftTimeline({ states: [value], index: 0 });
    setAutoSaveStatus(saveStatus);
    setAutoSaveError("");
  }, []);

  const editDraft = useCallback((valueOrUpdater, { replay = true } = {}) => {
    setEditorPml((current) => {
      const next =
        typeof valueOrUpdater === "function"
          ? valueOrUpdater(current)
          : String(valueOrUpdater || "");
      if (next === current) return current;
      editorPmlRef.current = next;
      draftGenerationRef.current += 1;
      setAutoSaveStatus("pending");
      setAutoSaveError("");
      setDraftTimeline((timeline) => {
        let states = timeline.states.slice(0, timeline.index + 1);
        states.push(next);
        if (states.length > 81) {
          states = [states[0], ...states.slice(states.length - 80)];
        }
        return { states, index: states.length - 1 };
      });
      if (replay) {
        window.clearTimeout(renderTimerRef.current);
        renderTimerRef.current = window.setTimeout(
          () => setRenderPml(next),
          900
        );
      }
      return next;
    });
  }, []);

  const applyWorkspace = useCallback(
    (next, { keepPanel = true } = {}) => {
      const structures = Array.isArray(next?.structures) ? next.structures : [];
      const pml = String(next?.pml ?? next?.version?.pml ?? "");
      const normalized = { ...next, structures, pml };
      workspaceRef.current = normalized;
      previewVersionRef.current = null;
      setWorkspace(normalized);
      resetDraft(pml);
      setPreviewVersion(null);
      setError("");
      setSelectedStructureId((current) =>
        structures.some((item) => item.id === current)
          ? current
          : structures.at(-1)?.id || null
      );
      if (!keepPanel) setRightCollapsed(true);
      refreshConversations();
    },
    [refreshConversations, resetDraft]
  );

  const applyExternalWorkspace = useCallback(
    (result) => {
      const next = result?.workspace || result;
      const current = workspaceRef.current;
      if (!next?.project || current?.project.id !== next.project.id) return;

      const structures = Array.isArray(next.structures) ? next.structures : [];
      const pml = String(next.pml ?? next.version?.pml ?? "");
      const normalized = { ...next, structures, pml };
      const isPreviewingHistory = Boolean(previewVersionRef.current);

      workspaceRef.current = normalized;
      setWorkspace(normalized);
      setUnreadProjectIds((ids) => withoutSetValue(ids, next.project.id));
      refreshConversations();

      // A history preview remains pinned to its own PML even when a newer
      // version arrives. Returning to latest will then use this new workspace.
      if (isPreviewingHistory) return;

      resetDraft(pml, { saveStatus: "saved" });
      setSelectedStructureId((selectedId) =>
        structures.some((item) => item.id === selectedId)
          ? selectedId
          : structures.at(-1)?.id || null
      );
      if (structures.length) setRightCollapsed(false);
    },
    [refreshConversations, resetDraft]
  );

  useEffect(() => {
    let cancelled = false;
    const requestedSession = new URL(window.location.href).searchParams.get(
      "session"
    );
    const requestedVersion = new URL(window.location.href).searchParams.get(
      "version"
    );

    (async () => {
      const initial = await api.bootstrap();
      let next = initial;
      if (requestedSession && requestedSession !== initial.project.id) {
        try {
          next = await api.activateProject(requestedSession);
        } catch (reason) {
          if (!cancelled) setError(reason.message);
        }
      }
      if (cancelled) return;
      applyWorkspace(next);
      if (next.structures?.length) setRightCollapsed(false);
      if (requestedVersion && requestedVersion !== next.version?.id) {
        try {
          const result = await api.getVersion(next.project.id, requestedVersion);
          if (cancelled) return;
          previewVersionRef.current = result.version;
          setPreviewVersion(result.version);
          resetDraft(result.version.pml);
        } catch (reason) {
          if (!cancelled) setError(reason.message);
        }
      } else if (requestedVersion) {
        replaceVersionInUrl(next.project.id, null);
      }
    })().catch((reason) => {
      if (!cancelled) setError(reason.message);
    });

    return () => {
      cancelled = true;
    };
  }, [api, applyWorkspace, resetDraft]);

  useEffect(() => {
    const url = new URL(window.location.href);
    const pairCode = url.searchParams.get("pair")?.trim();
    if (!pairCode || !workspace?.project.id) return;
    if (pairCompletionCodeRef.current === pairCode) return;
    pairCompletionCodeRef.current = pairCode;

    api
      .completePair(pairCode)
      .then(() => {
        url.searchParams.delete("pair");
        window.history.replaceState(
          null,
          "",
          `${url.pathname}${url.search}${url.hash}`
        );
      })
      .catch((reason) => {
        pairCompletionCodeRef.current = null;
        setError(reason.message);
      });
  }, [api, workspace?.project.id]);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem("chatpymol.theme", theme);
  }, [theme]);

  useEffect(() => {
    document.documentElement.lang = language === "en" ? "en" : "zh-CN";
    localStorage.setItem("chatpymol.language", language);
  }, [language]);

  useEffect(() => {
    localStorage.setItem("chatpymol.left-width", String(leftWidth));
    localStorage.setItem("chatpymol.right-width", String(rightWidth));
  }, [leftWidth, rightWidth]);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [workspace?.messages?.length, busy]);

  useEffect(() => {
    if (!emailPopoverOpen) return undefined;

    const closeOnOutsidePointer = (event) => {
      if (
        emailPopoverRef.current?.contains(event.target) ||
        emailTriggerRef.current?.contains(event.target)
      ) {
        return;
      }
      setEmailPopoverOpen(false);
      setEmailCopyStatus("idle");
    };
    const closeOnEscape = (event) => {
      if (event.key !== "Escape") return;
      setEmailPopoverOpen(false);
      setEmailCopyStatus("idle");
      emailTriggerRef.current?.focus();
    };

    document.addEventListener("pointerdown", closeOnOutsidePointer);
    document.addEventListener("keydown", closeOnEscape);
    const focusFrame = window.requestAnimationFrame(() => {
      emailCopyButtonRef.current?.focus();
    });
    return () => {
      document.removeEventListener("pointerdown", closeOnOutsidePointer);
      document.removeEventListener("keydown", closeOnEscape);
      window.cancelAnimationFrame(focusFrame);
    };
  }, [emailPopoverOpen]);

  useEffect(() => {
    if (!codexDialogOpen) return undefined;

    const closeOnEscape = (event) => {
      if (event.key !== "Escape") return;
      setCodexDialogOpen(false);
      setCodexCopyStatus("idle");
    };

    document.addEventListener("keydown", closeOnEscape);
    const focusFrame = window.requestAnimationFrame(() => {
      codexCopyButtonRef.current?.focus();
    });
    return () => {
      document.removeEventListener("keydown", closeOnEscape);
      window.cancelAnimationFrame(focusFrame);
    };
  }, [codexDialogOpen]);

  useEffect(
    () => () => {
      window.clearTimeout(renderTimerRef.current);
      window.clearTimeout(autoSaveTimerRef.current);
      window.clearTimeout(emailCopyTimerRef.current);
      window.clearTimeout(codexCopyTimerRef.current);
    },
    []
  );

  async function copyContactEmail() {
    const copied = await copyTextToClipboard("542058929@qq.com");
    setEmailCopyStatus(copied ? "copied" : "failed");
    window.clearTimeout(emailCopyTimerRef.current);
    emailCopyTimerRef.current = window.setTimeout(() => {
      setEmailCopyStatus("idle");
    }, 2200);
  }

  async function copyCodexPrompt() {
    const copied = await copyTextToClipboard(codexInstallPrompt);
    setCodexCopyStatus(copied ? "copied" : "failed");
    window.clearTimeout(codexCopyTimerRef.current);
    codexCopyTimerRef.current = window.setTimeout(() => {
      setCodexCopyStatus("idle");
    }, 2200);
  }

  const workspaceReady = Boolean(workspace?.project?.id);
  useEffect(() => {
    if (!workspaceReady || typeof EventSource === "undefined") {
      return undefined;
    }
    let closed = false;

    const hasLocalWork = () => {
      const current = workspaceRef.current;
      const preview = previewVersionRef.current;
      const basePml = String(preview?.pml || current?.pml || "");
      return Boolean(
        busyRef.current ||
          saveInFlightRef.current ||
          editorPmlRef.current !== basePml ||
          autoSaveStatusRef.current === "pending" ||
          autoSaveStatusRef.current === "saving"
      );
    };

    const schedule = (payload, delay = EXTERNAL_SYNC_DEBOUNCE_MS) => {
      if (closed) return;
      const queued = queuedExternalUpdateRef.current;
      const queuedProjectId = eventProjectId(queued);
      const incomingProjectId = eventProjectId(payload);
      if (
        queuedProjectId &&
        incomingProjectId &&
        queuedProjectId !== incomingProjectId
      ) {
        const keepQueuedSelection =
          isExplicitSessionSelection(queued) &&
          !isExplicitSessionSelection(payload);
        const unreadProjectId = keepQueuedSelection
          ? incomingProjectId
          : queuedProjectId;
        setUnreadProjectIds((ids) => withSetValue(ids, unreadProjectId));
        refreshConversations();
        if (!keepQueuedSelection) queuedExternalUpdateRef.current = payload;
      } else {
        queuedExternalUpdateRef.current = {
          ...(queued || {}),
          ...payload
        };
      }
      window.clearTimeout(externalSyncTimerRef.current);
      externalSyncTimerRef.current = window.setTimeout(
        () => scheduleExternalSyncRef.current?.run(),
        delay
      );
    };

    const run = async () => {
      if (closed || externalSyncInFlightRef.current) return;
      const payload = queuedExternalUpdateRef.current;
      if (!payload) return;
      queuedExternalUpdateRef.current = null;

      const current = workspaceRef.current;
      if (!current) {
        schedule(payload, EXTERNAL_SYNC_RETRY_MS);
        return;
      }

      const projectId = eventProjectId(payload) || current.project.id;
      const forceSelect = isExplicitSessionSelection(payload);
      if (projectId !== current.project.id && !forceSelect) {
        setUnreadProjectIds((ids) => withSetValue(ids, projectId));
        refreshConversations();
        return;
      }

      if (hasLocalWork()) {
        if (autoSaveStatusRef.current === "error") {
          queuedExternalUpdateRef.current = payload;
          return;
        }
        if (
          forceSelect &&
          !busyRef.current &&
          !saveInFlightRef.current &&
          autoSaveStatusRef.current === "pending"
        ) {
          flushNativeDraftRef.current?.().catch(() => {});
        }
        schedule(payload, EXTERNAL_SYNC_RETRY_MS);
        return;
      }

      externalSyncInFlightRef.current = true;
      try {
        const next = forceSelect
          ? await api.activateProject(projectId)
          : await api.getProject(projectId);
        const latestCurrent = workspaceRef.current;
        if (hasLocalWork()) {
          schedule(payload, EXTERNAL_SYNC_RETRY_MS);
        } else if (forceSelect) {
          applyWorkspace(next);
          setUnreadProjectIds((ids) => withoutSetValue(ids, projectId));
          replaceSessionInUrl(projectId);
          setRightCollapsed(next.structures.length === 0);
        } else if (latestCurrent?.project.id !== projectId) {
          setUnreadProjectIds((ids) => withSetValue(ids, projectId));
          refreshConversations();
        } else {
          applyExternalWorkspace(next);
        }
      } catch {
        const attempt = Number(payload.attempt || 0) + 1;
        if (attempt <= 4) {
          schedule({ ...payload, attempt }, EXTERNAL_SYNC_RETRY_MS * attempt);
        }
      } finally {
        externalSyncInFlightRef.current = false;
        if (queuedExternalUpdateRef.current) {
          schedule(queuedExternalUpdateRef.current);
        }
      }
    };

    scheduleExternalSyncRef.current = { schedule, run };

    const receiveWorkspaceUpdate = (event) => {
      let payload;
      try {
        payload = JSON.parse(event.data || "{}");
      } catch {
        return;
      }
      const type = payload.type || event.type;
      if (type !== "workspace.updated" && type !== "message") return;
      if (payload.clientId && payload.clientId === api.clientId) return;

      const current = workspaceRef.current;
      const projectId = eventProjectId(payload);
      if (
        current &&
        projectId &&
        projectId !== current.project.id &&
        !isExplicitSessionSelection(payload)
      ) {
        setUnreadProjectIds((ids) => withSetValue(ids, projectId));
        refreshConversations();
        return;
      }
      schedule(payload);
    };

    const eventSource = new EventSource(api.eventsUrl());
    eventSource.onmessage = receiveWorkspaceUpdate;
    eventSource.addEventListener("workspace.updated", receiveWorkspaceUpdate);

    return () => {
      closed = true;
      eventSource.close();
      window.clearTimeout(externalSyncTimerRef.current);
      queuedExternalUpdateRef.current = null;
      scheduleExternalSyncRef.current = null;
    };
  }, [
    api,
    applyExternalWorkspace,
    applyWorkspace,
    refreshConversations,
    workspaceReady
  ]);

  workspaceRef.current = workspace;
  previewVersionRef.current = previewVersion;
  editorPmlRef.current = editorPml;
  busyRef.current = busy;
  autoSaveStatusRef.current = autoSaveStatus;
  const currentVersion = previewVersion || workspace?.version;
  useEffect(() => {
    if (!menuId) return undefined;

    const focusFrame = window.requestAnimationFrame(() => {
      conversationMenuRef.current?.querySelector("button")?.focus();
    });

    const closeMenu = () => setMenuId(null);
    const handlePointerDown = (event) => {
      if (conversationMenuRef.current?.contains(event.target)) return;
      if (conversationMenuTriggerRef.current?.contains(event.target)) return;
      closeMenu();
    };
    const handleKeyDown = (event) => {
      if (event.key !== "Escape") return;
      closeMenu();
      conversationMenuTriggerRef.current?.focus();
    };

    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    window.addEventListener("resize", closeMenu);
    window.addEventListener("scroll", closeMenu, true);

    return () => {
      window.cancelAnimationFrame(focusFrame);
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("resize", closeMenu);
      window.removeEventListener("scroll", closeMenu, true);
    };
  }, [menuId]);
  const currentPml = previewVersion?.pml || workspace?.pml || "";
  const scenePml = renderPml || currentPml;
  const currentStructures = useMemo(
    () => structuresInVersion(scenePml, workspace?.structures || []),
    [scenePml, workspace?.structures]
  );
  const selectedStructure =
    workspace?.structures.find((item) => item.id === selectedStructureId) ||
    workspace?.structures.at(-1) ||
    null;
  const isDirty = Boolean(workspace && editorPml !== currentPml);
  const canUndoDraft = draftTimeline.index > 0;
  const canRedoDraft = draftTimeline.index < draftTimeline.states.length - 1;
  const versionMap = useMemo(
    () => new Map((workspace?.versions || []).map((item) => [item.id, item])),
    [workspace?.versions]
  );

  const flushNativeDraft = useCallback(async () => {
    window.clearTimeout(autoSaveTimerRef.current);

    while (saveInFlightRef.current) {
      try {
        await saveInFlightRef.current;
      } catch {
        // An explicit flush (send/switch/upload) gets one fresh retry cycle.
      }
    }

    const activeWorkspace = workspaceRef.current;
    const preview = previewVersionRef.current;
    const pml = editorPmlRef.current;
    const basePml = String(preview?.pml || activeWorkspace?.pml || "");
    if (!activeWorkspace) {
      return { workspace: activeWorkspace, changed: false };
    }
    if (pml === basePml) {
      nativeConflictRef.current = null;
      setAutoSaveStatus("saved");
      setAutoSaveError("");
      return { workspace: activeWorkspace, changed: false };
    }

    const projectId = activeWorkspace.project.id;
    const origin = preview || activeWorkspace.version;
    let generation = draftGenerationRef.current;
    let submittedPml = pml;
    let submittedBasePml = basePml;
    let submittedBaseVersionId = activeWorkspace.version.id;
    let submittedParentVersionId = origin.id;
    let wasRebased = false;
    setAutoSaveStatus("saving");
    setAutoSaveError("");

    const adoptSafeRebase = (rebasedPml, latest, liveGeneration) => {
      submittedPml = rebasedPml;
      submittedBasePml = String(latest.pml || "");
      submittedBaseVersionId = latest.version.id;
      submittedParentVersionId = latest.version.id;
      generation = liveGeneration;
      wasRebased = true;
      nativeConflictRef.current = null;

      if (workspaceRef.current?.project.id !== projectId) return;
      window.clearTimeout(renderTimerRef.current);
      previewVersionRef.current = null;
      editorPmlRef.current = rebasedPml;
      setPreviewVersion(null);
      setEditorPml(rebasedPml);
      setRenderPml(rebasedPml);
      setDraftTimeline((timeline) => {
        const states = [...timeline.states];
        states[timeline.index] = rebasedPml;
        return { ...timeline, states };
      });
      setAutoSaveStatus("saving");
      replaceVersionInUrl(projectId, null);
    };

    const rememberedConflict = nativeConflictRef.current;
    if (rememberedConflict?.projectId === projectId) {
      const recoveredPml = rebaseNativePmlDraft(
        rememberedConflict.basePml,
        submittedPml,
        activeWorkspace.pml
      );
      if (recoveredPml === null) {
        const conflict = createNativeMergeConflict(
          t,
          activeWorkspace.version.id
        );
        setAutoSaveStatus("error");
        setAutoSaveError(conflict.message);
        throw conflict;
      }
      adoptSafeRebase(
        recoveredPml,
        activeWorkspace,
        draftGenerationRef.current
      );
    }

    const operation = (async () => {
      let lastError = null;
      for (
        let attempt = 0;
        attempt < NATIVE_AUTO_SAVE_ATTEMPTS + 1;
        attempt += 1
      ) {
        try {
          return await api.savePml(
            projectId,
            submittedPml,
            submittedBaseVersionId,
            wasRebased
              ? "原生 PyMOL 自动合并保存"
              : preview
              ? `基于版本 ${origin.revision} 的自动保存`
              : "原生 PyMOL 自动保存",
            {
              source: "native-pymol-autosave",
              parentVersionId: submittedParentVersionId,
              publishToChat: false
            }
          );
        } catch (reason) {
          lastError = reason;
          if (
            reason.status === 409 &&
            attempt < NATIVE_AUTO_SAVE_ATTEMPTS
          ) {
            const latestResult = await api.getProject(projectId);
            const latest = latestResult?.workspace || latestResult;
            const liveDraft = editorPmlRef.current;
            const liveGeneration = draftGenerationRef.current;
            const rebasedPml = rebaseNativePmlDraft(
              submittedBasePml,
              liveDraft,
              latest.pml
            );

            if (workspaceRef.current?.project.id === projectId) {
              workspaceRef.current = latest;
              setWorkspace(latest);
              refreshConversations();
            }

            if (rebasedPml === null) {
              nativeConflictRef.current = {
                projectId,
                basePml: submittedBasePml,
                latestVersionId: latest.version?.id || null
              };
              const conflict = createNativeMergeConflict(
                t,
                latest.version?.id
              );
              throw conflict;
            }

            adoptSafeRebase(rebasedPml, latest, liveGeneration);
            continue;
          }
          const retryable =
            !reason.status || reason.status === 429 || reason.status >= 500;
          if (!retryable || attempt === NATIVE_AUTO_SAVE_ATTEMPTS) {
            throw reason;
          }
          await wait((attempt + 1) * 450);
        }
      }
      throw lastError;
    })();

    saveInFlightRef.current = operation;
    try {
      const result = await operation;
      if (workspaceRef.current?.project.id === projectId) {
        workspaceRef.current = result.workspace;
        previewVersionRef.current = null;
        setWorkspace(result.workspace);
        setPreviewVersion(null);
        refreshConversations();

        if (
          draftGenerationRef.current === generation &&
          editorPmlRef.current === submittedPml
        ) {
          const normalizedPml = String(result.workspace.pml || submittedPml);
          editorPmlRef.current = normalizedPml;
          setEditorPml(normalizedPml);
          setRenderPml(normalizedPml);
          setDraftTimeline((timeline) => {
            if (timeline.states[timeline.index] !== submittedPml) return timeline;
            const states = [...timeline.states];
            states[timeline.index] = normalizedPml;
            return { ...timeline, states };
          });
          setAutoSaveStatus("saved");
        } else {
          setAutoSaveStatus("pending");
        }
        setAutoSaveError("");
        nativeConflictRef.current = null;
        replaceVersionInUrl(projectId, null);
        if (queuedExternalUpdateRef.current) {
          scheduleExternalSyncRef.current?.schedule(
            queuedExternalUpdateRef.current
          );
        }
      }
      return { ...result, changed: true };
    } catch (reason) {
      if (workspaceRef.current?.project.id === projectId) {
        setAutoSaveStatus("error");
        setAutoSaveError(reason.message || t("自动保存失败"));
      }
      throw reason;
    } finally {
      if (saveInFlightRef.current === operation) {
        saveInFlightRef.current = null;
      }
    }
  }, [api, refreshConversations, t]);

  flushNativeDraftRef.current = flushNativeDraft;

  useEffect(() => {
    window.clearTimeout(autoSaveTimerRef.current);
    if (!workspace || editorPml === currentPml) return undefined;

    setAutoSaveStatus((current) =>
      current === "saving" ? current : "pending"
    );
    autoSaveTimerRef.current = window.setTimeout(() => {
      flushNativeDraftRef.current?.().catch(() => {});
    }, NATIVE_AUTO_SAVE_DELAY_MS);

    return () => window.clearTimeout(autoSaveTimerRef.current);
  }, [currentPml, editorPml, previewVersion?.id, workspace?.project.id]);

  const handleNativeCommands = useCallback(
    (commands, { replay = false } = {}) => {
      const clean = String(commands || "").trim();
      if (!clean) return;
      const isManagedView = clean.includes("# @chatpymol view-begin");
      editDraft(
        (current) => {
          const base = isManagedView
            ? current.replace(MANAGED_VIEW_RE, "").trimEnd()
            : current.trimEnd();
          return `${base}\n\n${
            isManagedView ? "" : "# PyMOL 原生界面操作\n"
          }${clean}\n`;
        },
        { replay }
      );
    },
    [editDraft]
  );

  function undoDraft() {
    window.clearTimeout(renderTimerRef.current);
    setDraftTimeline((timeline) => {
      if (timeline.index <= 0) return timeline;
      const index = timeline.index - 1;
      const pml = timeline.states[index];
      editorPmlRef.current = pml;
      draftGenerationRef.current += 1;
      setEditorPml(pml);
      setRenderPml(pml);
      setAutoSaveStatus("pending");
      setAutoSaveError("");
      return { ...timeline, index };
    });
  }

  function redoDraft() {
    window.clearTimeout(renderTimerRef.current);
    setDraftTimeline((timeline) => {
      if (timeline.index >= timeline.states.length - 1) return timeline;
      const index = timeline.index + 1;
      const pml = timeline.states[index];
      editorPmlRef.current = pml;
      draftGenerationRef.current += 1;
      setEditorPml(pml);
      setRenderPml(pml);
      setAutoSaveStatus("pending");
      setAutoSaveError("");
      return { ...timeline, index };
    });
  }

  function startResize(side, event) {
    event.preventDefault();
    const startX = event.clientX;
    const startWidth = side === "left" ? leftWidth : rightWidth;
    document.body.classList.add("is-resizing");
    const onMove = (moveEvent) => {
      if (side === "left") {
        const max = Math.max(
          210,
          Math.min(
            360,
            window.innerWidth - (rightCollapsed ? 0 : rightWidth) - 430
          )
        );
        setLeftWidth(
          Math.min(
            max,
            Math.max(210, startWidth + moveEvent.clientX - startX)
          )
        );
      } else {
        const max = Math.max(
          440,
          window.innerWidth - (leftCollapsed ? 0 : leftWidth) - 430
        );
        setRightWidth(
          Math.min(
            max,
            Math.max(440, startWidth - moveEvent.clientX + startX)
          )
        );
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
    setBusy("new");
    try {
      await flushNativeDraft();
      const next = await api.createProject(t("新对话"));
      applyWorkspace(next, { keepPanel: false });
      setUnreadProjectIds((ids) => withoutSetValue(ids, next.project.id));
      replaceSessionInUrl(next.project.id);
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
      await flushNativeDraft();
      const next = await api.activateProject(projectId);
      applyWorkspace(next);
      setUnreadProjectIds((ids) => withoutSetValue(ids, projectId));
      replaceSessionInUrl(projectId);
      setRightCollapsed(next.structures.length === 0);
    } catch (reason) {
      setError(reason.message);
    } finally {
      setBusy("");
    }
  }

  async function renameConversation(projectId) {
    const title = titleDraft.trim();
    if (!title) return;
    setEditingId(null);
    try {
      const result = await api.updateProject(projectId, { title });
      setConversations(result.projects);
      if (workspace.project.id === projectId) {
        setWorkspace((current) => ({ ...current, project: result.project }));
      }
    } catch (reason) {
      setError(reason.message);
    }
  }

  async function togglePinned(conversation) {
    try {
      const result = await api.updateProject(conversation.id, {
        pinned: !conversation.pinned
      });
      setConversations(result.projects);
      setMenuId(null);
    } catch (reason) {
      setError(reason.message);
    }
  }

  async function deleteConversation(conversation) {
    if (!window.confirm(t("确定删除这个对话吗？此操作不可撤销。"))) return;
    setBusy(`delete:${conversation.id}`);
    try {
      const result = await api.deleteProject(conversation.id);
      applyWorkspace(result.workspace);
      setUnreadProjectIds((ids) => withoutSetValue(ids, conversation.id));
      replaceSessionInUrl(result.workspace.project.id);
      setRightCollapsed(result.workspace.structures.length === 0);
      setMenuId(null);
    } catch (reason) {
      setError(reason.message);
    } finally {
      setBusy("");
    }
  }

  async function sendMessage(event) {
    event?.preventDefault();
    const message = chatInput.trim();
    if (!message || !workspace || busy) return;

    const before = workspace;
    let committedWorkspace = null;
    let aiBase = before;
    setChatInput("");
    setBusy("ai");
    setError("");

    try {
      const saved = await flushNativeDraft();
      aiBase = saved.workspace || workspaceRef.current || before;
      if (saved.changed) committedWorkspace = aiBase;

      const optimisticWorkspace = {
        ...aiBase,
        messages: [
          ...aiBase.messages,
          {
            id: `pending-${Date.now()}`,
            role: "user",
            content: message,
            createdAt: new Date().toISOString()
          }
        ]
      };
      workspaceRef.current = optimisticWorkspace;
      setWorkspace(optimisticWorkspace);

      const result = await api.askAi(
        aiBase.project.id,
        message,
        aiBase.version.id
      );
      applyWorkspace(result.workspace);
      replaceVersionInUrl(result.workspace.project.id, null);
      if (result.workspace.structures.length > aiBase.structures.length) {
        setRightCollapsed(false);
      }
    } catch (reason) {
      if (committedWorkspace) {
        applyWorkspace(committedWorkspace);
      } else {
        workspaceRef.current = before;
        setWorkspace(before);
      }
      setChatInput(message);
      setError(reason.message);
    } finally {
      setBusy("");
    }
  }

  async function handleUpload(fileList) {
    const files = Array.from(fileList || []);
    if (!workspace || !files.length) return;
    setBusy("upload");
    try {
      const saved = await flushNativeDraft();
      const uploadBase = saved.workspace || workspaceRef.current || workspace;
      const result = await api.uploadStructures(uploadBase.project.id, files);
      setSelectedStructureId(
        result.added.at(-1)?.structure?.id ||
          result.workspace.structures.at(-1)?.id ||
          null
      );
      applyWorkspace(result.workspace);
      replaceVersionInUrl(result.workspace.project.id, null);
      setRightCollapsed(false);
    } catch (reason) {
      setError(reason.message);
    } finally {
      setBusy("");
    }
  }

  async function openVersion(versionId) {
    if (!versionId || !workspace) return;
    if (versionId === currentVersion?.id) {
      if (!previewVersionRef.current) {
        replaceVersionInUrl(workspace.project.id, null);
      }
      setRightCollapsed(false);
      return;
    }
    try {
      await flushNativeDraft();
    } catch (reason) {
      setError(reason.message);
      return;
    }
    const activeWorkspace = workspaceRef.current || workspace;
    if (versionId === activeWorkspace.version.id) {
      previewVersionRef.current = null;
      setPreviewVersion(null);
      resetDraft(activeWorkspace.pml);
      replaceVersionInUrl(activeWorkspace.project.id, null);
      setRightCollapsed(false);
      return;
    }
    try {
      const result = await api.getVersion(activeWorkspace.project.id, versionId);
      previewVersionRef.current = result.version;
      setPreviewVersion(result.version);
      resetDraft(result.version.pml);
      replaceVersionInUrl(activeWorkspace.project.id, result.version.id);
      setRightCollapsed(false);
    } catch (reason) {
      setError(reason.message);
    }
  }

  async function returnToLatest() {
    if (!workspace) return;
    try {
      await flushNativeDraft();
    } catch (reason) {
      setError(reason.message);
      return;
    }
    const activeWorkspace = workspaceRef.current || workspace;
    previewVersionRef.current = null;
    setPreviewVersion(null);
    resetDraft(activeWorkspace.pml);
    replaceVersionInUrl(activeWorkspace.project.id, null);
  }

  async function restorePreview() {
    if (!previewVersion || !workspace || busy) return;
    setBusy("restore");
    try {
      const result = await api.restore(
        workspace.project.id,
        previewVersion.id,
        workspace.version.id
      );
      applyWorkspace(result.workspace);
      replaceVersionInUrl(result.workspace.project.id, null);
    } catch (reason) {
      setError(reason.message);
    } finally {
      setBusy("");
    }
  }

  if (!workspace) {
    return (
      <main className="clean-boot">
        <LoaderCircle className="spin" size={18} />
      </main>
    );
  }

  const visibleMessages = workspace.messages.filter(
    (message) =>
      message.mode !== "manual-edit" &&
      !(
        message.mode === "system" &&
        message.content.startsWith("欢迎来到 ChatPyMOL")
      )
  );

  return (
    <div className="clean-app">
      <header className="clean-nav">
        <div className="clean-nav-left">
          <button
            className="icon-button"
            onClick={() => setLeftCollapsed((value) => !value)}
            aria-label={t(leftCollapsed ? "展开左侧栏" : "收起左侧栏")}
          >
            <Menu size={18} />
          </button>
          <strong>ChatPyMOL</strong>
          <span>{t("AI 与人工协作的分子可视化工作台")}</span>
        </div>
        <div className="clean-nav-actions">
          <button
            className={`icon-button ${rightCollapsed ? "" : "active"}`}
            onClick={() => setRightCollapsed((value) => !value)}
            aria-label={t(rightCollapsed ? "打开工作区" : "关闭工作区")}
          >
            <PanelRight size={17} />
          </button>
          <a
            className="icon-button"
            href={GITHUB_URL}
            target="_blank"
            rel="noopener noreferrer"
            aria-label="GitHub"
            title="GitHub"
          >
            <Github size={17} />
          </a>
          <a
            className="icon-button"
            href={ISSUE_URL}
            target="_blank"
            rel="noopener noreferrer"
            aria-label={t("提交 Issue")}
            title={t("提交 Issue")}
          >
            <MessageSquarePlus size={16} strokeWidth={1.7} />
          </a>
          <div className="clean-contact-wrap">
            <button
              ref={emailTriggerRef}
              className={`icon-button ${emailPopoverOpen ? "active" : ""}`}
              type="button"
              aria-label={t("邮件联系")}
              aria-haspopup="dialog"
              aria-expanded={emailPopoverOpen}
              aria-controls="chatpymol-contact-popover"
              title={t("邮件联系")}
              onClick={() => {
                setEmailPopoverOpen((open) => !open);
                setEmailCopyStatus("idle");
              }}
            >
              <Mail size={16} strokeWidth={1.7} />
            </button>
            {emailPopoverOpen && (
              <section
                ref={emailPopoverRef}
                id="chatpymol-contact-popover"
                className="clean-contact-popover"
                role="dialog"
                aria-labelledby="chatpymol-contact-title"
              >
                <div className="clean-contact-heading">
                  <span id="chatpymol-contact-title">
                    {t("联系 ChatPyMOL")}
                  </span>
                  <small>{t("欢迎交流使用体验与合作想法")}</small>
                </div>
                <div className="clean-contact-email-row">
                  <a href={EMAIL_URL}>542058929@qq.com</a>
                  <button
                    ref={emailCopyButtonRef}
                    type="button"
                    className={`clean-contact-copy ${emailCopyStatus}`}
                    onClick={copyContactEmail}
                    aria-label={t("复制邮箱地址")}
                  >
                    {emailCopyStatus === "copied" ? (
                      <Check size={14} aria-hidden="true" />
                    ) : (
                      <Copy size={14} aria-hidden="true" />
                    )}
                    <span aria-live="polite">
                      {emailCopyStatus === "copied"
                        ? t("已复制")
                        : emailCopyStatus === "failed"
                          ? t("复制失败")
                          : t("复制")}
                    </span>
                  </button>
                </div>
              </section>
            )}
          </div>
          <button
            className="language-clean"
            onClick={() => setLanguage(language === "zh" ? "en" : "zh")}
            aria-label={t("切换中英文")}
          >
            <Languages size={16} />
            <span>{language === "zh" ? "EN" : "中"}</span>
          </button>
          <button
            className="icon-button"
            onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
            aria-label={t("切换亮色或暗色")}
          >
            {theme === "dark" ? <Sun size={17} /> : <Moon size={17} />}
          </button>
        </div>
      </header>

      {error && (
        <div className="clean-error">
          <span>{error}</span>
          <button onClick={() => setError("")} aria-label={t("关闭")}>
            <X size={14} />
          </button>
        </div>
      )}

      <main className="clean-layout">
        {!leftCollapsed && (
          <aside className="clean-sidebar" style={{ width: leftWidth }}>
            <button
              className="clean-new-chat"
              onClick={newConversation}
              disabled={Boolean(busy)}
            >
              {busy === "new" ? (
                <LoaderCircle className="spin" size={16} />
              ) : (
                <Plus size={16} />
              )}
              {t("新建对话")}
            </button>
            <div className="clean-conversations">
              {conversations.map((conversation) => (
                <div
                  key={conversation.id}
                  className={`clean-conversation-row ${
                    conversation.id === workspace.project.id ? "active" : ""
                  } ${
                    unreadProjectIds.has(conversation.id) ? "has-unread" : ""
                  }`}
                >
                  {editingId === conversation.id ? (
                    <form
                      onSubmit={(event) => {
                        event.preventDefault();
                        renameConversation(conversation.id);
                      }}
                    >
                      <input
                        autoFocus
                        value={titleDraft}
                        onChange={(event) => setTitleDraft(event.target.value)}
                        onBlur={() => renameConversation(conversation.id)}
                        maxLength={120}
                      />
                    </form>
                  ) : (
                    <button
                      className="conversation-title-button"
                      onClick={() => switchConversation(conversation.id)}
                    >
                      {conversation.pinned && <Pin size={11} />}
                      <span>{t(conversation.title)}</span>
                      {unreadProjectIds.has(conversation.id) && (
                        <i
                          className="conversation-unread-dot"
                          aria-label={t("有来自 CLI 的新版本")}
                          title={t("有来自 CLI 的新版本")}
                        />
                      )}
                    </button>
                  )}
                  <button
                    className="conversation-menu-button"
                    onClick={(event) =>
                      toggleConversationMenu(conversation.id, event)
                    }
                    aria-label={t("对话菜单")}
                    aria-haspopup="menu"
                    aria-expanded={menuId === conversation.id}
                  >
                    {busy === `switch:${conversation.id}` ||
                    busy === `delete:${conversation.id}` ? (
                      <LoaderCircle className="spin" size={14} />
                    ) : (
                      <MoreHorizontal size={16} />
                    )}
                  </button>
                </div>
              ))}
            </div>
            <button
              type="button"
              className="clean-codex-entry"
              onClick={() => {
                setCodexDialogOpen(true);
                setCodexCopyStatus("idle");
              }}
              aria-haspopup="dialog"
            >
              <SquareTerminal size={16} />
              <span>{t("在 Codex 中使用")}</span>
              <ChevronRight size={14} />
            </button>
          </aside>
        )}

        {!leftCollapsed && (
          <ResizeHandle
            side="left"
            label={t("调整左侧栏宽度")}
            onPointerDown={(event) => startResize("left", event)}
          />
        )}

        <section className="clean-chat-column">
          <div className="clean-chat-scroll">
            {visibleMessages.length === 0 ? (
              <div className="clean-empty-chat">
                <h1>{t("想看哪个结构？")}</h1>
                <p>
                  {t("上传结构文件，或直接告诉我 PDB ID 和你想看到的内容。")}
                </p>
              </div>
            ) : (
              visibleMessages.map((message) => (
                <article
                  key={message.id}
                  className={`clean-message clean-message-${message.role}`}
                >
                  {message.role === "assistant" && (
                    <span className="clean-avatar">
                      <Bot size={15} />
                    </span>
                  )}
                  <div className="clean-message-content">
                    {["example-request", "official-request"].includes(
                      message.demoStep
                    ) && (
                      <span className="message-demo-badge">
                        {t("官方示例")}
                      </span>
                    )}
                    <p>
                      {language === "en" && message.contentEn
                        ? message.contentEn
                        : message.content}
                    </p>
                    {(message.demoStep === "example-ready"
                      ? []
                      : message.structureIds || []
                    ).map((structureId) => {
                      const structure = workspace.structures.find(
                        (item) => item.id === structureId
                      );
                      if (!structure) return null;
                      return (
                        <button
                          key={structure.id}
                          type="button"
                          className="message-structure-card"
                          onClick={() => {
                            setSelectedStructureId(structure.id);
                            setRightCollapsed(false);
                          }}
                        >
                          <span className="message-structure-icon">
                            <FileBox size={18} />
                          </span>
                          <span className="message-structure-meta">
                            <strong>{structure.filename}</strong>
                            <small>
                              {structure.format.toUpperCase()} ·{" "}
                              {formatBytes(structure.bytes)}
                            </small>
                          </span>
                          <PanelRight size={15} />
                        </button>
                      );
                    })}
                    {message.versionId &&
                      message.demoStep !== "example-loaded" && (
                        <MessageVersionCard
                          version={versionMap.get(message.versionId)}
                          isCurrent={
                            message.versionId === workspace.version.id &&
                            !previewVersion
                          }
                          isViewing={message.versionId === previewVersion?.id}
                          isDraftBase={
                            isDirty && message.versionId === currentVersion?.id
                          }
                          onOpen={() => openVersion(message.versionId)}
                          isDemo={message.mode === "demo"}
                          t={t}
                        />
                      )}
                  </div>
                </article>
              ))
            )}
            {busy === "ai" && (
              <article className="clean-message clean-message-assistant">
                <span className="clean-avatar">
                  <Bot size={15} />
                </span>
                <div className="clean-thinking">
                  <i />
                  <i />
                  <i />
                </div>
              </article>
            )}
            <div ref={chatEndRef} />
          </div>

          <div className="clean-composer-area">
            {workspace.structures.length > 0 && (
              <div className="structure-chips">
                {workspace.structures.map((structure) => (
                  <button
                    key={structure.id}
                    className={
                      structure.id === selectedStructure?.id ? "active" : ""
                    }
                    onClick={() => {
                      setSelectedStructureId(structure.id);
                      setRightCollapsed(false);
                    }}
                  >
                    <FileBox size={13} />
                    <span>{structure.filename}</span>
                  </button>
                ))}
              </div>
            )}
            <form className="clean-composer" onSubmit={sendMessage}>
              <textarea
                value={chatInput}
                onChange={(event) => setChatInput(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && !event.shiftKey) {
                    event.preventDefault();
                    sendMessage(event);
                  }
                }}
                placeholder={t("描述你想怎样查看或修改结构…")}
                rows={3}
              />
              <div>
                <button
                  type="button"
                  className="icon-button"
                  onClick={() => fileInputRef.current?.click()}
                  aria-label={t("上传文件")}
                  title={t("上传文件")}
                >
                  {busy === "upload" ? (
                    <LoaderCircle className="spin" size={17} />
                  ) : (
                    <Paperclip size={17} />
                  )}
                </button>
                <button
                  className="clean-send"
                  disabled={!chatInput.trim() || Boolean(busy)}
                  aria-label={t("发送")}
                >
                  {busy === "ai" ? (
                    <LoaderCircle className="spin" size={16} />
                  ) : (
                    <Send size={16} />
                  )}
                </button>
              </div>
            </form>
          </div>
        </section>

        {!rightCollapsed && (
          <ResizeHandle
            side="right"
            label={t("调整右侧栏宽度")}
            onPointerDown={(event) => startResize("right", event)}
          />
        )}

        <aside
          className={`clean-right-panel ${
            rightCollapsed ? "is-collapsed" : ""
          }`}
          style={{ width: rightCollapsed ? 0 : rightWidth }}
          aria-hidden={rightCollapsed}
        >
          {previewVersion && (
            <div className="clean-scene-statusbar history">
              <div className="clean-scene-version">
                <span>{t("历史版本")}</span>
              </div>
              <div className="clean-draft-tools">
                <button type="button" onClick={returnToLatest}>
                  {t("返回最新")}
                </button>
                {!isDirty && (
                  <button
                    type="button"
                    onClick={restorePreview}
                    disabled={Boolean(busy)}
                  >
                    {busy === "restore" && (
                      <LoaderCircle className="spin" size={12} />
                    )}
                    {t("恢复为新版本")}
                  </button>
                )}
              </div>
            </div>
          )}

          <div className="clean-viewer-wrap">
            <NativePyMOLViewer
              api={api}
              projectId={workspace.project.id}
              pml={scenePml}
              structures={currentStructures}
              versionId={currentVersion.id}
              exportName={`${safeDownloadName(
                workspace.project.title
              )}-v${currentVersion.revision}${isDirty ? "-draft" : ""}`}
              revision={currentVersion.revision}
              autoSaveStatus={autoSaveStatus}
              autoSaveError={autoSaveError}
              onRetryAutoSave={() => flushNativeDraft().catch(() => {})}
              canUndo={canUndoDraft}
              canRedo={canRedoDraft}
              onUndo={undoDraft}
              onRedo={redoDraft}
              onDownloadStructure={
                selectedStructure
                  ? () =>
                      api.downloadStructure(
                        workspace.project.id,
                        selectedStructure
                      )
                  : undefined
              }
              onDownloadPml={() =>
                api.downloadPml(
                  workspace.project.id,
                  `${safeDownloadName(workspace.project.title)}-v${currentVersion.revision}`
                )
              }
              onNativeCommands={handleNativeCommands}
              language={language}
              t={t}
            />
          </div>
        </aside>
      </main>

      <input
        ref={fileInputRef}
        type="file"
        multiple
        hidden
        accept=".pdb,.ent,.cif,.mmcif,.bcif,.mol2,.sdf,.mol,.xyz,.gro,.mrc,.ccp4"
        onChange={(event) => {
          handleUpload(event.target.files);
          event.target.value = "";
        }}
      />
      {menuConversation &&
        createPortal(
          <div
            ref={conversationMenuRef}
            className="conversation-menu"
            role="menu"
            aria-label={t("对话菜单")}
            style={menuPosition}
          >
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                setEditingId(menuConversation.id);
                setTitleDraft(menuConversation.title);
                setMenuId(null);
              }}
            >
              <Pencil size={14} />
              {t("重命名")}
            </button>
            <button
              type="button"
              role="menuitem"
              onClick={() => togglePinned(menuConversation)}
            >
              {menuConversation.pinned ? (
                <PinOff size={14} />
              ) : (
                <Pin size={14} />
              )}
              {t(menuConversation.pinned ? "取消置顶" : "置顶")}
            </button>
            <button
              type="button"
              role="menuitem"
              className="danger"
              onClick={() => deleteConversation(menuConversation)}
            >
              <Trash2 size={14} />
              {t("删除")}
            </button>
          </div>,
          document.body
        )}
      {codexDialogOpen &&
        createPortal(
          <div
            className="clean-dialog-backdrop"
            onPointerDown={(event) => {
              if (event.target !== event.currentTarget) return;
              setCodexDialogOpen(false);
              setCodexCopyStatus("idle");
            }}
          >
            <section
              className="clean-codex-dialog"
              role="dialog"
              aria-modal="true"
              aria-labelledby="chatpymol-codex-title"
            >
              <div className="clean-codex-dialog-heading">
                <span className="clean-codex-dialog-icon">
                  <SquareTerminal size={18} />
                </span>
                <div>
                  <h2 id="chatpymol-codex-title">
                    {t("在 Codex 中使用 ChatPyMOL")}
                  </h2>
                  <p>
                    {t(
                      "复制下面的 Prompt 给 Codex，它会完成 CLI、插件、MCP 与浏览器配对。"
                    )}
                  </p>
                </div>
                <button
                  type="button"
                  className="clean-codex-close"
                  onClick={() => {
                    setCodexDialogOpen(false);
                    setCodexCopyStatus("idle");
                  }}
                  aria-label={t("关闭")}
                >
                  <X size={16} />
                </button>
              </div>
              <pre className="clean-codex-prompt">{codexInstallPrompt}</pre>
              <div className="clean-codex-actions">
                <a
                  href={CODEX_GUIDE_URL}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  {t("查看完整接入指南")}
                </a>
                <button
                  ref={codexCopyButtonRef}
                  type="button"
                  className={`clean-codex-copy ${codexCopyStatus}`}
                  onClick={copyCodexPrompt}
                >
                  {codexCopyStatus === "copied" ? (
                    <Check size={15} />
                  ) : (
                    <Copy size={15} />
                  )}
                  <span aria-live="polite">
                    {codexCopyStatus === "copied"
                      ? t("Prompt 已复制")
                      : codexCopyStatus === "failed"
                        ? t("复制失败")
                        : t("复制安装 Prompt")}
                  </span>
                </button>
              </div>
            </section>
          </div>,
          document.body
        )}
    </div>
  );
}

async function copyTextToClipboard(value) {
  try {
    if (!navigator.clipboard?.writeText) {
      throw new Error("Clipboard unavailable");
    }
    await navigator.clipboard.writeText(value);
    return true;
  } catch {
    const input = document.createElement("textarea");
    input.value = value;
    input.setAttribute("readonly", "");
    input.style.position = "fixed";
    input.style.opacity = "0";
    document.body.appendChild(input);
    input.select();
    let copied = false;
    try {
      copied = document.execCommand("copy");
    } catch {
      copied = false;
    }
    input.remove();
    return copied;
  }
}

function MessageVersionCard({
  version,
  isCurrent,
  isViewing,
  isDraftBase,
  onOpen,
  isDemo,
  t
}) {
  if (!version) return null;
  const state = isDraftBase
    ? "draft"
    : isViewing
      ? "viewing"
      : isCurrent
        ? "current"
        : "history";
  const stateLabel = isDraftBase
    ? t("草稿基于此版本")
    : isViewing
      ? t("查看中")
      : isCurrent
        ? t("当前")
        : t("历史");
  const actorLabel = isDemo
    ? t("示例")
    : version.actor === "ai"
      ? "AI"
      : t("人工");
  const summary = String(version.summary || "")
    .replace(/^Uploaded\s+/i, `${t("载入")} `)
    .replace(/^Imported\s+/i, `${t("导入")} `);
  const time = new Date(version.createdAt).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit"
  });
  return (
    <button
      type="button"
      className={`message-version-card version-${state}`}
      onClick={onOpen}
      aria-label={t("打开这个版本")}
    >
      <span className="message-version-icon">
        <History size={15} />
      </span>
      <span className="message-version-meta">
        <strong>
          v{version.revision} · {summary}
        </strong>
        <small>
          {actorLabel} · {time}
        </small>
      </span>
      <em>{stateLabel}</em>
    </button>
  );
}

function ResizeHandle({ side, label, onPointerDown }) {
  return (
    <div
      className={`clean-resize-handle clean-resize-${side}`}
      role="separator"
      aria-orientation="vertical"
      aria-label={label}
      onPointerDown={onPointerDown}
    >
      <i />
    </div>
  );
}

function structuresInVersion(pml, structures) {
  if (!structures.length) return [];
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

function safeDownloadName(value) {
  return (
    String(value || "chatpymol-scene")
      .trim()
      .replace(/[\/:*?"<>|]+/g, "-")
      .replace(/\s+/g, "-")
      .slice(0, 80) || "chatpymol-scene"
  );
}

function eventProjectId(payload) {
  return payload?.projectId || payload?.conversationId || payload?.sessionId;
}

function isExplicitSessionSelection(payload) {
  return payload?.forceSelect === true || payload?.action === "session.selected";
}

function createNativeMergeConflict(t, currentVersionId) {
  const error = new Error(
    t(
      "检测到 CLI/AI 已提交新版本，当前人工草稿无法安全自动合并；草稿已保留。请撤销冲突修改或重新加载最新版本。"
    )
  );
  error.status = 409;
  error.currentVersionId = currentVersionId;
  return error;
}

function withSetValue(values, value) {
  if (!value || values.has(value)) return values;
  const next = new Set(values);
  next.add(value);
  return next;
}

function withoutSetValue(values, value) {
  if (!value || !values.has(value)) return values;
  const next = new Set(values);
  next.delete(value);
  return next;
}

function replaceSessionInUrl(projectId) {
  replaceVersionInUrl(projectId, null);
}

function replaceVersionInUrl(projectId, versionId) {
  if (!projectId) return;
  const url = new URL(window.location.href);
  url.searchParams.set("session", projectId);
  if (versionId) url.searchParams.set("version", versionId);
  else url.searchParams.delete("version");
  window.history.replaceState(
    null,
    "",
    `${url.pathname}${url.search}${url.hash}`
  );
}

function wait(milliseconds) {
  return new Promise((resolve) => window.setTimeout(resolve, milliseconds));
}
