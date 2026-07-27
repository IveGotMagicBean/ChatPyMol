import { useCallback, useEffect, useRef, useState } from "react";
import {
  Box,
  ChevronDown,
  Download,
  Eye,
  EyeOff,
  FileBox,
  FileCode2,
  Focus,
  ImageDown,
  ListTree,
  LoaderCircle,
  MousePointer2,
  Palette,
  Play,
  Redo2,
  RefreshCw,
  Tag,
  TerminalSquare,
  TriangleAlert,
  Undo2,
  X
} from "lucide-react";
import "./native-pymol.css";

const PYODIDE_BASE = "/pyodide/";
const PYMOL_WHEEL =
  import.meta.env.VITE_PYMOL_WHEEL ||
  "/pymol-wasm/pymol-2.6.0a0-cp39-cp39-emscripten_3_1_46_wasm32.whl";
const NATIVE_GUI_CONTROL_SIZE = 20;
const NATIVE_LOG = "/chatpymol-native-actions.pml";
const SEQUENCE_PREFERENCE_VERSION = "2";
const MANAGED_VIEW_RE =
  /\n*# @chatpymol view-begin[\s\S]*?# @chatpymol view-end\n?/g;

const SELECTION_MODES = [
  { value: 0, label: "原子" },
  { value: 1, label: "残基" },
  { value: 2, label: "链" },
  { value: 4, label: "对象" }
];

const REPRESENTATION_ACTIONS = [
  {
    label: "卡通",
    api: { type: "representation", value: "cartoon" },
    command: (target) =>
      `show lines, ${target}; show cartoon, ${target}; hide sticks, ${target}; hide spheres, ${target}; hide surface, ${target}; hide mesh, ${target}; hide dots, ${target}; hide ribbon, ${target}; hide lines, ${target}`
  },
  {
    label: "球棍",
    api: { type: "ball-stick" },
    command: (target) =>
      `show lines, ${target}; set stick_ball, on, ${target}; set stick_ball_ratio, 1.5, ${target}; set stick_ball_color, atomic, ${target}; set stick_radius, 0.16, ${target}; show sticks, ${target}; hide spheres, ${target}; hide cartoon, ${target}; hide ribbon, ${target}; hide surface, ${target}; hide mesh, ${target}; hide dots, ${target}; color gray70, ${target}; color red, ${target} and elem O; color blue, ${target} and elem N; color yellow, ${target} and elem S; color orange, ${target} and elem P; hide lines, ${target}`
  },
  {
    label: "表面",
    api: { type: "representation", value: "surface" },
    command: (target) =>
      `show lines, ${target}; show surface, ${target}; hide cartoon, ${target}; hide ribbon, ${target}; hide sticks, ${target}; hide spheres, ${target}; hide mesh, ${target}; hide dots, ${target}; hide lines, ${target}`
  },
  {
    label: "球体",
    api: { type: "representation", value: "spheres" },
    command: (target) =>
      `show lines, ${target}; show spheres, ${target}; hide cartoon, ${target}; hide ribbon, ${target}; hide sticks, ${target}; hide surface, ${target}; hide mesh, ${target}; hide dots, ${target}; hide lines, ${target}`
  },
  {
    label: "线条",
    api: { type: "representation", value: "lines" },
    command: (target) =>
      `show lines, ${target}; hide cartoon, ${target}; hide ribbon, ${target}; hide sticks, ${target}; hide spheres, ${target}; hide surface, ${target}; hide mesh, ${target}; hide dots, ${target}`
  }
];

const COLOR_ACTIONS = [
  {
    label: "海蓝",
    swatch: "#3b82c4",
    api: { type: "color", value: "marine" },
    command: (target) => `color marine, ${target}`
  },
  {
    label: "青色",
    swatch: "#42c7c7",
    api: { type: "color", value: "cyan" },
    command: (target) => `color cyan, ${target}`
  },
  {
    label: "珊瑚",
    swatch: "#ef7d72",
    api: { type: "color", value: "salmon" },
    command: (target) => `color salmon, ${target}`
  },
  {
    label: "粉红",
    swatch: "#f39ac4",
    api: { type: "color", value: "hotpink" },
    command: (target) => `color hotpink, ${target}`
  },
  {
    label: "黄色",
    swatch: "#e8c547",
    api: { type: "color", value: "yellow" },
    command: (target) => `color yellow, ${target}`
  },
  {
    label: "绿色",
    swatch: "#62b96b",
    api: { type: "color", value: "green" },
    command: (target) => `color green, ${target}`
  },
  {
    label: "灰色",
    swatch: "#a5a5a5",
    api: { type: "color", value: "gray70" },
    command: (target) => `color gray70, ${target}`
  }
];

const QUICK_ACTIONS = {
  zoom: {
    label: "聚焦",
    api: { type: "zoom" },
    command: (target) => `zoom ${target}`
  },
  hide: {
    label: "隐藏全部",
    api: { type: "hide" },
    command: (target) => `hide everything, ${target}`
  }
};

const OBJECT_PANEL_SECTIONS = [
  {
    key: "action",
    label: "操作",
    icon: Focus,
    actions: [
      {
        label: "聚焦",
        command: (target) => `zoom ${target}, 5`
      },
      {
        label: "调整方向",
        command: (target) => `orient ${target}`
      },
      {
        label: "居中",
        command: (target) => `center ${target}`
      }
    ]
  },
  {
    key: "show",
    label: "显示",
    icon: Eye,
    actions: [
      { label: "卡通", command: (target) => `show cartoon, ${target}` },
      { label: "球棍", command: (target) => `show sticks, ${target}` },
      { label: "表面", command: (target) => `show surface, ${target}` },
      { label: "球体", command: (target) => `show spheres, ${target}` },
      { label: "线条", command: (target) => `show lines, ${target}` }
    ]
  },
  {
    key: "hide",
    label: "隐藏",
    icon: EyeOff,
    actions: [
      { label: "卡通", command: (target) => `hide cartoon, ${target}` },
      { label: "球棍", command: (target) => `hide sticks, ${target}` },
      { label: "表面", command: (target) => `hide surface, ${target}` },
      { label: "球体", command: (target) => `hide spheres, ${target}` },
      { label: "全部表示", command: (target) => `hide everything, ${target}` }
    ]
  },
  {
    key: "label",
    label: "标签",
    icon: Tag,
    actions: [
      {
        label: "残基名称与编号",
        command: (target) =>
          `label (${target} and name CA), "%s%s" % (resn, resi)`
      },
      {
        label: "原子名称",
        command: (target) => `label ${target}, name`
      },
      {
        label: "清除标签",
        command: (target) => `label ${target}, ""`
      }
    ]
  },
  {
    key: "color",
    label: "颜色",
    icon: Palette,
    actions: [
      ...COLOR_ACTIONS,
      {
        label: "按链配色",
        command: (target) => `util.cbc ${target}`
      },
      {
        label: "按元素配色",
        command: (target) =>
          `color gray70, ${target}; color red, ${target} and elem O; color blue, ${target} and elem N; color yellow, ${target} and elem S; color orange, ${target} and elem P`
      }
    ]
  }
];

let pyodidePromise;

export function NativePyMOLViewer({
  api,
  projectId,
  pml,
  structures,
  versionId,
  revision,
  exportName,
  autoSaveStatus = "idle",
  autoSaveError = "",
  onRetryAutoSave,
  canUndo = false,
  canRedo = false,
  onUndo,
  onRedo,
  onDownloadStructure,
  onDownloadPml,
  onNativeCommands,
  language,
  t = (value) => value
}) {
  const shellRef = useRef(null);
  const canvasRef = useRef(null);
  const runtimeRef = useRef(null);
  const queueRef = useRef(Promise.resolve());
  const sceneRequestRef = useRef(0);
  const appliedPmlRef = useRef("");
  const loadedSceneKeyRef = useRef("");
  const sceneReadyRef = useRef(false);
  const logOffsetRef = useRef(0);
  const renderWarningsRef = useRef([]);
  const pointerRef = useRef(null);
  const dragFrameRef = useRef(0);
  const pendingDragRef = useRef(null);
  const viewCaptureTimerRef = useRef(0);
  const feedbackTimerRef = useRef(0);
  const commandInputRef = useRef(null);
  const sequenceVisibleRef = useRef(readInitialSequencePreference());
  const selectionModeRef = useRef(
    normalizeSelectionMode(
      Number(readPreference("chatpymol.selection-mode", "1"))
    )
  );
  const [command, setCommand] = useState("");
  const [runtimeReady, setRuntimeReady] = useState(false);
  const [sequenceVisible, setSequenceVisible] = useState(
    sequenceVisibleRef.current
  );
  const [selectionMode, setSelectionMode] = useState(
    selectionModeRef.current
  );
  const [activeSelection, setActiveSelection] = useState(null);
  const [selectionActionsOpen, setSelectionActionsOpen] = useState(false);
  const [sceneObjects, setSceneObjects] = useState([]);
  const [objectsLoading, setObjectsLoading] = useState(false);
  const [openObjectMenu, setOpenObjectMenu] = useState("");
  const [feedback, setFeedback] = useState("");
  const [state, setState] = useState({
    kind: "loading",
    progress: 5,
    label: t("正在加载示例蛋白，首次打开会稍久")
  });
  const isReady = state.kind === "ready" || state.kind === "warning";

  const showFeedback = useCallback((message) => {
    window.clearTimeout(feedbackTimerRef.current);
    setFeedback(message);
    feedbackTimerRef.current = window.setTimeout(() => setFeedback(""), 1800);
  }, []);

  const enqueue = useCallback((task) => {
    const next = queueRef.current.then(task, task);
    queueRef.current = next.catch(() => {});
    return next;
  }, []);

  const refreshObjects = useCallback(() => {
    if (!runtimeRef.current) return Promise.resolve([]);
    setObjectsLoading(true);
    return enqueue(async () => {
      const runtime = runtimeRef.current;
      if (!runtime) return [];
      const encoded = await runtime.runPythonAsync(`
chatpymol_enabled_objects = set(
    _p.cmd.get_names("objects", enabled_only=1)
)
chatpymol_object_rows = []
for chatpymol_object_name in _p.cmd.get_names("objects", enabled_only=0):
    try:
        chatpymol_object_type = _p.cmd.get_type(chatpymol_object_name)
    except Exception:
        chatpymol_object_type = "object:unknown"
    if chatpymol_object_type != "object:molecule":
        continue
    chatpymol_object_rows.append({
        "name": chatpymol_object_name,
        "enabled": chatpymol_object_name in chatpymol_enabled_objects
    })
json.dumps(chatpymol_object_rows)
`);
      const rows = JSON.parse(String(encoded || "[]"));
      setSceneObjects(rows);
      setOpenObjectMenu((current) => {
        if (!current) return current;
        const objectName = current.split("::", 1)[0];
        return rows.some((item) => item.name === objectName) ? current : "";
      });
      return rows;
    }).finally(() => setObjectsLoading(false));
  }, [enqueue]);

  const refreshSelection = useCallback(
    (revealActions = false) =>
      enqueue(async () => {
        const runtime = runtimeRef.current;
        if (!runtime) return null;
        const encoded = await runtime.runPythonAsync(`
chatpymol_active_selections = _p.cmd.get_names(
    "public_selections", enabled_only=1
)
chatpymol_selection_name = (
    "sele" if "sele" in chatpymol_active_selections
    else (chatpymol_active_selections[0] if chatpymol_active_selections else "")
)
chatpymol_selection_rows = []
if chatpymol_selection_name:
    _p.cmd.iterate(
        chatpymol_selection_name,
        "chatpymol_selection_rows.append((model,segi,chain,resn,resi,name,elem,index))",
        space={"chatpymol_selection_rows": chatpymol_selection_rows}
    )
chatpymol_atom_keys = sorted(set(
    (row[0], row[7]) for row in chatpymol_selection_rows
))
chatpymol_residue_keys = sorted(set(
    (row[0], row[1], row[2], row[3], row[4])
    for row in chatpymol_selection_rows
))
chatpymol_chain_keys = sorted(set(
    (row[0], row[1], row[2]) for row in chatpymol_selection_rows
))
json.dumps({
    "name": chatpymol_selection_name,
    "count": len(chatpymol_selection_rows),
    "objects": sorted(set(row[0] for row in chatpymol_selection_rows)),
    "atoms": chatpymol_atom_keys,
    "residues": chatpymol_residue_keys,
    "chains": chatpymol_chain_keys,
    "first": chatpymol_selection_rows[0] if chatpymol_selection_rows else None
})
`);
        const parsed = JSON.parse(String(encoded || "{}"));
        if (!parsed.name || !parsed.count) {
          setActiveSelection(null);
          setSelectionActionsOpen(false);
          return null;
        }
        const next = {
          ...parsed,
          expression: selectionExpression(parsed, selectionModeRef.current)
        };
        setActiveSelection(next);
        if (revealActions) setSelectionActionsOpen(true);
        return next;
      }),
    [enqueue]
  );

  const applyViewerChrome = useCallback(
    async (nextSequenceVisible) => {
      sequenceVisibleRef.current = nextSequenceVisible;
      setSequenceVisible(nextSequenceVisible);
      writePreference(
        "chatpymol.sequence-view",
        nextSequenceVisible ? "on" : "off"
      );
      await enqueue(async () => {
        const runtime = runtimeRef.current;
        if (!runtime) return;
        runtime.globals.set(
          "chatpymol_sequence_visible",
          nextSequenceVisible
        );
        runtime.globals.set("chatpymol_panel_visible", true);
        await runtime.runPythonAsync(`
chatpymol_reserved_width = chatpymol_gui_width
_p.cmd.set("internal_gui", 1)
_p.cmd.set("internal_gui_width", chatpymol_gui_width)
_p.cmd.set("internal_gui_control_size", ${NATIVE_GUI_CONTROL_SIZE})
_p.cmd.set("internal_gui_mode", 0)
_p.cmd.set("seq_view", 1 if chatpymol_sequence_visible else 0)
_p.cmd.set("mouse_grid", 0)
try:
    _p.reshape(chatpymol_width, chatpymol_height, 1)
except Exception:
    pass
_p._cmd.glViewport(0, 0, chatpymol_width, chatpymol_height)
_p.cmd.viewport(max(1, chatpymol_width-chatpymol_reserved_width), chatpymol_height)
try:
    _p.cmd.dirty()
except Exception:
    pass
for _chatpymol_chrome_draw_pass in range(2):
    _p.idle()
    _p.draw()
`);
      });
    },
    [enqueue]
  );

  useEffect(() => {
    let cancelled = false;

    async function start() {
      try {
        const canvas = canvasRef.current;
        const shell = shellRef.current;
        if (!canvas || !shell) return;

        sizeCanvas(canvas, shell);
        setState({
          kind: "loading",
          progress: 12,
          label: t("正在准备浏览器分子引擎")
        });
        const pyodide = await getPyodide();
        if (cancelled) return;

        setState({
          kind: "loading",
          progress: 48,
          label: t("正在加载 PyMOL 核心，首次打开会稍久")
        });
        await pyodide.loadPackage("numpy");
        await pyodide.loadPackage(PYMOL_WHEEL);
        if (cancelled) return;

        const guiWidth = nativeGuiWidth(canvas.width);
        setDimensions(
          pyodide,
          canvas.width,
          canvas.height,
          guiWidth
        );
        pyodide.globals.set(
          "chatpymol_sequence_visible",
          sequenceVisibleRef.current
        );
        setState({
          kind: "loading",
          progress: 78,
          label: t("正在准备可编辑界面")
        });

        await pyodide.runPythonAsync(`
class ChatPyMOLSelfProxy:
    def __init__(self, proxied, _self):
        self._self = _self
        self.proxied = proxied
    def __getattr__(self, key):
        value = getattr(self.proxied, key)
        def wrapper(*args, **kwargs):
            kwargs["_self"] = self._self
            return value(*args, **kwargs)
        return wrapper

import contextlib
import io
import json
import os
import pymol
import pymol2 as p2
import pymol.util
import pymol.preset

try:
    _p.stop()
except Exception:
    pass

_p = p2.PyMOL()
pymol.cmd = _p.cmd
_p.start()
_p.util = ChatPyMOLSelfProxy(pymol.util, _p.cmd)
_p.preset = ChatPyMOLSelfProxy(pymol.preset, _p.cmd)
_p.cmd.set("internal_gui", 1)
_p.cmd.set("internal_feedback", 0)
_p.initEmscriptenContext(0, 0, 0, 0, 0)
_p._cmd.glViewport(0, 0, chatpymol_width, chatpymol_height)
_p.cmd.viewport(max(1, chatpymol_width-chatpymol_reserved_width), chatpymol_height)

def chatpymol_safe_set(name, value):
    try:
        _p.cmd.set(name, value)
    except Exception:
        pass

chatpymol_safe_set("internal_gui", 1)
chatpymol_safe_set("internal_gui_width", chatpymol_gui_width)
chatpymol_safe_set("internal_gui_control_size", ${NATIVE_GUI_CONTROL_SIZE})
chatpymol_safe_set("internal_gui_mode", 0)
chatpymol_safe_set("seq_view", 1 if chatpymol_sequence_visible else 0)
chatpymol_safe_set("mouse_grid", 0)
chatpymol_safe_set("mouse_selection_mode", ${selectionModeRef.current})
chatpymol_safe_set("auto_number_selections", 0)
chatpymol_safe_set("active_selections", 1)
chatpymol_safe_set("auto_show_selections", 1)
chatpymol_safe_set("auto_hide_selections", 1)
chatpymol_safe_set("robust_logs", "on")
chatpymol_safe_set("log_conformations", "on")
chatpymol_safe_set("internal_feedback", 0)
chatpymol_safe_set("internal_prompt", 0)
chatpymol_safe_set("label_font_id", 10)
chatpymol_safe_set("render_as_cylinders", "off")
chatpymol_safe_set("dash_as_cylinders", "on")
chatpymol_safe_set("nonbonded_as_cylinders", "off")
try:
    _p.cmd.mouse("three_button_viewing")
except Exception:
    pass
_p.cmd.set_color("chatpymol_canvas_bg", [0.035, 0.043, 0.058])
_p.cmd.bg_color("chatpymol_canvas_bg")
try:
    _p.reshape(chatpymol_width, chatpymol_height, 1)
except Exception:
    pass
`);
        runtimeRef.current = pyodide;
        setRuntimeReady(true);
        setState({
          kind: "ready",
          progress: 100,
          label: t("PyMOL 原生界面已就绪")
        });
      } catch (error) {
        console.error(error);
        if (!cancelled) {
          setRuntimeReady(false);
          setState({
            kind: "error",
            progress: 0,
            label:
              language === "en"
                ? `Native PyMOL failed to start: ${error.message}`
                : `原生 PyMOL 启动失败：${error.message}`
          });
        }
      }
    }

    start();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!runtimeReady || !runtimeRef.current) return;
    if (!structures.length) {
      sceneRequestRef.current += 1;
      appliedPmlRef.current = "";
      loadedSceneKeyRef.current = "";
      sceneReadyRef.current = false;
      setActiveSelection(null);
      setSelectionActionsOpen(false);
      setSceneObjects([]);
      setOpenObjectMenu("");
      setState({
        kind: "empty",
        progress: 100,
        label: language === "en" ? "Waiting for a structure" : "等待结构文件"
      });
      return;
    }
    let cancelled = false;
    const requestId = ++sceneRequestRef.current;
    const nextSceneKey = sceneKeyFor(projectId, structures);

    async function applyIncremental(commands) {
      setState({
        kind: "loading-scene",
        progress: 98,
        label: t("正在应用修改")
      });
      try {
        let commandWarnings = [];
        await enqueue(async () => {
          const runtime = runtimeRef.current;
          if (!runtime || cancelled) return;
          runtime.globals.set(
            "chatpymol_incremental_commands_json",
            JSON.stringify(commands)
          );
          const encodedWarnings = await runtime.runPythonAsync(`
chatpymol_incremental_warnings = []
chatpymol_incremental_error_markers = (
    "error", "traceback", "nameerror", "syntaxerror",
    "exception", "invalid", "not found", "unrecognized"
)
for chatpymol_incremental_command in json.loads(chatpymol_incremental_commands_json):
    try:
        chatpymol_incremental_feedback = io.StringIO()
        with contextlib.redirect_stdout(chatpymol_incremental_feedback), contextlib.redirect_stderr(chatpymol_incremental_feedback):
            _p.cmd.do(chatpymol_incremental_command, log=0, echo=0)
        chatpymol_incremental_feedback_text = chatpymol_incremental_feedback.getvalue().strip()
        if any(marker in chatpymol_incremental_feedback_text.lower() for marker in chatpymol_incremental_error_markers):
            chatpymol_incremental_warnings.append({
                "command": chatpymol_incremental_command,
                "error": chatpymol_incremental_feedback_text[-500:]
            })
    except Exception as chatpymol_incremental_error:
        chatpymol_incremental_warnings.append({
            "command": chatpymol_incremental_command,
            "error": str(chatpymol_incremental_error)
        })
chatpymol_reserved_width = chatpymol_gui_width
_p.cmd.set("internal_gui", 1)
_p.cmd.set("internal_gui_width", chatpymol_gui_width)
_p.cmd.set("internal_gui_control_size", ${NATIVE_GUI_CONTROL_SIZE})
_p.cmd.set("internal_gui_mode", 0)
_p.cmd.set("seq_view", 1 if chatpymol_sequence_visible else 0)
try:
    _p.reshape(chatpymol_width, chatpymol_height, 1)
except Exception:
    pass
_p._cmd.glViewport(0, 0, chatpymol_width, chatpymol_height)
_p.cmd.viewport(max(1, chatpymol_width-chatpymol_reserved_width), chatpymol_height)
_p.idle()
_p.draw()
json.dumps(chatpymol_incremental_warnings)
`);
          commandWarnings = JSON.parse(String(encodedWarnings || "[]"));
        });
        await applyViewerChrome(sequenceVisibleRef.current);
        if (cancelled || requestId !== sceneRequestRef.current) return;
        if (commandWarnings.length) {
          throw new Error(commandWarnings[0].error || "增量命令执行失败");
        }
        appliedPmlRef.current = pml;
        loadedSceneKeyRef.current = nextSceneKey;
        sceneReadyRef.current = true;
        renderWarningsRef.current = [];
        if (commands.some(commandAffectsSelection)) {
          await refreshSelection();
        }
        if (!cancelled) {
          setState({
            kind: "ready",
            progress: 100,
            label:
              language === "en"
                ? `Native PyMOL · ${versionLabel(versionId)}`
                : `原生 PyMOL · ${versionLabel(versionId)}`
          });
        }
      } catch (error) {
        if (!cancelled && requestId === sceneRequestRef.current) {
          sceneReadyRef.current = false;
          await replayScene();
        }
      }
    }

    async function replayScene() {
      sceneReadyRef.current = false;
      setState({
        kind: "loading-scene",
        progress: 92,
        label: t("正在显示当前蛋白与版本")
      });
      try {
        const files = [];
        for (const structure of structures) {
          const bytes = await api.structureBytes(projectId, structure);
          if (cancelled || requestId !== sceneRequestRef.current) return;
          files.push({
            bytes,
            filename: safeFilename(structure.filename),
            objectName: structure.objectName
          });
        }

        let commandWarnings = [];
        await enqueue(async () => {
          const runtime = runtimeRef.current;
          if (!runtime || cancelled) return;
          try {
            await runtime.runPythonAsync("_p.cmd.log_close()");
          } catch {
            // No log is open on the first render.
          }
          await runtime.runPythonAsync('_p.cmd.delete("all")');

          for (const file of files) {
            const path = `/home/pyodide/${file.filename}`;
            runtime.FS.writeFile(path, file.bytes);
            runtime.globals.set("chatpymol_file_path", path);
            runtime.globals.set("chatpymol_object_name", file.objectName);
            await runtime.runPythonAsync(
              "_p.cmd.load(chatpymol_file_path, chatpymol_object_name)"
            );
          }

          runtime.globals.set(
            "chatpymol_commands_json",
            JSON.stringify(renderableCommands(pml))
          );
          runtime.globals.set(
            "chatpymol_sequence_visible",
            sequenceVisibleRef.current
          );
          const encodedWarnings = await runtime.runPythonAsync(`
chatpymol_command_warnings = []
chatpymol_error_markers = (
    "error",
    "traceback",
    "nameerror",
    "syntaxerror",
    "exception",
    "invalid",
    "not found",
    "unrecognized"
)
for chatpymol_command in json.loads(chatpymol_commands_json):
    try:
        chatpymol_feedback = io.StringIO()
        with contextlib.redirect_stdout(chatpymol_feedback), contextlib.redirect_stderr(chatpymol_feedback):
            _p.cmd.do(chatpymol_command, log=0, echo=0)
        chatpymol_feedback_text = chatpymol_feedback.getvalue().strip()
        if any(marker in chatpymol_feedback_text.lower() for marker in chatpymol_error_markers):
            chatpymol_command_warnings.append({
                "command": chatpymol_command,
                "error": chatpymol_feedback_text[-500:]
            })
    except Exception as chatpymol_error:
        chatpymol_command_warnings.append({
            "command": chatpymol_command,
            "error": str(chatpymol_error)
        })
chatpymol_reserved_width = chatpymol_gui_width
_p.cmd.set("internal_gui", 1)
_p.cmd.set("internal_gui_width", chatpymol_gui_width)
_p.cmd.set("internal_gui_control_size", ${NATIVE_GUI_CONTROL_SIZE})
_p.cmd.set("internal_gui_mode", 0)
_p.cmd.set("seq_view", 1 if chatpymol_sequence_visible else 0)
_p.cmd.set("mouse_grid", 0)
try:
    _p.reshape(chatpymol_width, chatpymol_height, 1)
except Exception:
    pass
_p._cmd.glViewport(0, 0, chatpymol_width, chatpymol_height)
_p.cmd.viewport(max(1, chatpymol_width-chatpymol_reserved_width), chatpymol_height)
try:
    _p.cmd.dirty()
except Exception:
    pass
for _chatpymol_scene_draw_pass in range(2):
    _p.idle()
    _p.draw()
try:
    if os.path.exists("${NATIVE_LOG}"):
        os.unlink("${NATIVE_LOG}")
except Exception:
    pass
_p.cmd.log_open("${NATIVE_LOG}", "w")
json.dumps(chatpymol_command_warnings)
`);
          commandWarnings = JSON.parse(String(encodedWarnings || "[]"));
          renderWarningsRef.current = commandWarnings;
          logOffsetRef.current = 0;
        });
        // PyMOL-WASM lazily paints the classic internal GUI. A second,
        // separate runtime turn is required here; drawing it inside the scene
        // replay call leaves only the reserved white strip until first input.
        await applyViewerChrome(sequenceVisibleRef.current);
        if (cancelled || requestId !== sceneRequestRef.current) return;
        appliedPmlRef.current = pml;
        loadedSceneKeyRef.current = nextSceneKey;
        sceneReadyRef.current = true;
        await refreshSelection();
        if (!cancelled) {
          setState({
            kind: commandWarnings.length ? "warning" : "ready",
            progress: 100,
            label: commandWarnings.length
              ? language === "en"
                ? `${commandWarnings.length} command(s) were not applied · ${versionLabel(versionId)}`
                : `${commandWarnings.length} 条命令未执行 · ${versionLabel(versionId)}`
              : language === "en"
                ? `Native PyMOL · ${versionLabel(versionId)}`
                : `原生 PyMOL · ${versionLabel(versionId)}`
          });
        }
      } catch (error) {
        console.error(error);
        sceneReadyRef.current = false;
        if (!cancelled) {
          setRuntimeReady(false);
          setState({
            kind: "error",
            progress: 0,
            label: error.message
          });
        }
      }
    }

    const deltaCommands = pmlCommandDelta(appliedPmlRef.current, pml);
    const canReuseScene =
      sceneReadyRef.current && loadedSceneKeyRef.current === nextSceneKey;
    if (canReuseScene && deltaCommands && deltaCommands.length === 0) {
      appliedPmlRef.current = pml;
      setState({
        kind: "ready",
        progress: 100,
        label:
          language === "en"
            ? `Native PyMOL · ${versionLabel(versionId)}`
            : `原生 PyMOL · ${versionLabel(versionId)}`
      });
    } else if (
      canReuseScene &&
      deltaCommands?.length &&
      deltaCommands.every(isIncrementalCommand)
    ) {
      applyIncremental(deltaCommands);
    } else {
      replayScene();
    }
    return () => {
      cancelled = true;
    };
  }, [
    api,
    applyViewerChrome,
    enqueue,
    language,
    pml,
    projectId,
    refreshSelection,
    structures,
    t,
    versionId,
    runtimeReady
  ]);

  useEffect(() => {
    if (!runtimeRef.current || !isReady) return;
    const timer = window.setInterval(async () => {
      const runtime = runtimeRef.current;
      if (!runtime) return;
      try {
        const data = runtime.FS.readFile(NATIVE_LOG, { encoding: "utf8" });
        if (data.length < logOffsetRef.current) logOffsetRef.current = 0;
        if (data.length > logOffsetRef.current) {
          const addition = data.slice(logOffsetRef.current);
          logOffsetRef.current = data.length;
          const cleaned = cleanNativeLog(addition);
          if (cleaned) {
            appliedPmlRef.current = appendPmlCommands(
              appliedPmlRef.current,
              cleaned
            );
            onNativeCommands?.(cleaned);
            showFeedback(t("原生操作已应用"));
          }
        }
      } catch {
        // The log file is created after the first scene is ready.
      }
    }, 700);
    return () => window.clearInterval(timer);
  }, [
    onNativeCommands,
    showFeedback,
    state.kind,
    t
  ]);

  useEffect(() => {
    const shell = shellRef.current;
    const canvas = canvasRef.current;
    if (!shell || !canvas) return;
    let resizeFrame = 0;
    const observer = new ResizeObserver(() => {
      window.cancelAnimationFrame(resizeFrame);
      resizeFrame = window.requestAnimationFrame(() => {
        fitCanvasToShell(canvas, shell);
      });
    });
    observer.observe(shell);
    return () => {
      window.cancelAnimationFrame(resizeFrame);
      observer.disconnect();
    };
  }, []);

  const pointerCoordinates = (event) => {
    const canvas = canvasRef.current;
    const rect = canvas.getBoundingClientRect();
    if (!rect.width || !rect.height) return { x: 0, y: 0 };
    const x = Math.floor(
      ((event.clientX - rect.left) / rect.width) * canvas.width
    );
    const y = Math.floor(
      ((event.clientY - rect.top) / rect.height) * canvas.height
    );
    return {
      x: Math.min(canvas.width - 1, Math.max(0, x)),
      y: Math.min(canvas.height - 1, Math.max(0, y))
    };
  };

  const runMouse = useCallback(
    (code, coordinates, button = 0, modifiers = 0) =>
      enqueue(async () => {
        const runtime = runtimeRef.current;
        if (!runtime) return;
        runtime.globals.set("chatpymol_mouse_x", coordinates.x);
        runtime.globals.set("chatpymol_mouse_y", coordinates.y);
        runtime.globals.set("chatpymol_mouse_button", button);
        runtime.globals.set("chatpymol_modifiers", modifiers);
        await runtime.runPythonAsync(code);
      }),
    [enqueue]
  );

  const captureNativeView = useCallback(
    () =>
      enqueue(async () => {
        const runtime = runtimeRef.current;
        if (!runtime) return;
        const encoded = await runtime.runPythonAsync(
          "json.dumps(list(_p.cmd.get_view()))"
        );
        const values = JSON.parse(encoded).map((value) =>
          Number(value).toFixed(8)
        );
        const managedView = `# @chatpymol view-begin\nset_view (${values.join(", ")})\n# @chatpymol view-end`;
        appliedPmlRef.current = `${appliedPmlRef.current
          .replace(MANAGED_VIEW_RE, "")
          .trimEnd()}\n\n${managedView}\n`;
        onNativeCommands?.(managedView);
      }),
    [enqueue, onNativeCommands]
  );

  const scheduleViewCapture = useCallback(
    (delay = 120) => {
      window.clearTimeout(viewCaptureTimerRef.current);
      viewCaptureTimerRef.current = window.setTimeout(
        () => captureNativeView(),
        delay
      );
    },
    [captureNativeView]
  );

  useEffect(
    () => () => {
      window.clearTimeout(viewCaptureTimerRef.current);
      window.clearTimeout(feedbackTimerRef.current);
    },
    []
  );

  function handlePointerDown(event) {
    if (!runtimeRef.current || !isReady) return;
    event.preventDefault();
    canvasRef.current.focus();
    canvasRef.current.setPointerCapture?.(event.pointerId);
    const coordinates = pointerCoordinates(event);
    const button = event.button;
    const modifiers = modifierMask(event);
    pointerRef.current = {
      pointerId: event.pointerId,
      button,
      modifiers,
      startX: coordinates.x,
      startY: coordinates.y,
      moved: false
    };
    runMouse(
      `_p.button(chatpymol_mouse_button, 0, chatpymol_mouse_x, chatpymol_height-chatpymol_mouse_y, chatpymol_modifiers)`,
      coordinates,
      button,
      modifiers
    );
  }

  function handlePointerMove(event) {
    const pointer = pointerRef.current;
    if (pointer && pointer.pointerId !== event.pointerId) return;
    event.preventDefault();
    const coordinates = pointerCoordinates(event);
    const modifiers = modifierMask(event);
    if (
      pointer &&
      (Math.abs(coordinates.x - pointer.startX) > 2 ||
        Math.abs(coordinates.y - pointer.startY) > 2)
    ) {
      pointer.moved = true;
    }
    pendingDragRef.current = coordinates;
    if (dragFrameRef.current) return;
    dragFrameRef.current = requestAnimationFrame(() => {
      dragFrameRef.current = 0;
      const next = pendingDragRef.current;
      if (!next) return;
      runMouse(
        `_p.drag(chatpymol_mouse_x, chatpymol_height-chatpymol_mouse_y, chatpymol_modifiers)
_p.idle()
_p.draw()`,
        next,
        pointer?.button || 0,
        modifiers
      );
    });
  }

  function handlePointerUp(event) {
    const pointer = pointerRef.current;
    if (!pointer || pointer.pointerId !== event.pointerId) return;
    event.preventDefault();
    const coordinates = pointerCoordinates(event);
    pointerRef.current = null;
    const modifiers = modifierMask(event);
    const clickCode = `_p.idle()
_p.drag(chatpymol_mouse_x, chatpymol_height-chatpymol_mouse_y, chatpymol_modifiers)
_p.idle()
_p.draw()
_p.button(
    chatpymol_mouse_button,
    1,
    max(0, chatpymol_mouse_x-1),
    max(0, chatpymol_height-chatpymol_mouse_y-1),
    chatpymol_modifiers
)
_p.idle()
_p.drag(chatpymol_mouse_x, chatpymol_height-chatpymol_mouse_y, chatpymol_modifiers)
_p.idle()
_p.draw()`;
    runMouse(
      pointer.button === 0 && !pointer.moved
        ? clickCode
        : `_p.button(chatpymol_mouse_button, 1, chatpymol_mouse_x, chatpymol_height-chatpymol_mouse_y, chatpymol_modifiers)
_p.idle()
_p.draw()`,
      coordinates,
      pointer.button,
      modifiers
    ).then(() => {
      if (pointer.button === 0 && !pointer.moved) {
        refreshSelection(true);
      } else {
        scheduleViewCapture(0);
      }
    });
  }

  function handleWheel(event) {
    if (!runtimeRef.current || !isReady) return;
    event.preventDefault();
    const coordinates = pointerCoordinates(event);
    const button = event.deltaY < 0 ? 3 : 4;
    const modifiers = modifierMask(event);
    runMouse(
      `_p.button(chatpymol_mouse_button, 0, chatpymol_mouse_x, chatpymol_height-chatpymol_mouse_y, chatpymol_modifiers)
_p.idle()
_p.draw()`,
      coordinates,
      button,
      modifiers
    ).then(() => scheduleViewCapture(180));
  }

  function handleKeyDown(event) {
    if (!runtimeRef.current || !isReady) return;
    const encoded = encodePyMOLKey(event);
    if (!encoded) return;
    const modifiers = modifierMask(event);
    event.preventDefault();
    enqueue(async () => {
      const runtime = runtimeRef.current;
      if (!runtime) return;
      runtime.globals.set("chatpymol_key_code", encoded.code);
      runtime.globals.set("chatpymol_key_state", encoded.state);
      runtime.globals.set("chatpymol_modifiers", modifiers);
      await runtime.runPythonAsync(`
_p.button(
    chatpymol_key_code,
    chatpymol_key_state,
    chatpymol_width // 2,
    chatpymol_height // 2,
    chatpymol_modifiers
)
_p.idle()
_p.draw()
`);
    });
  }

  async function runEditorCommand(value, label) {
    if (!value || !runtimeRef.current || !isReady) return;
    const commands = interactiveCommands(value);
    if (!commands.length) return;
    try {
      const commandWarnings = await enqueue(async () => {
        const runtime = runtimeRef.current;
        if (!runtime) return [];
        runtime.globals.set(
          "chatpymol_user_commands_json",
          JSON.stringify(commands)
        );
        const encodedWarnings = await runtime.runPythonAsync(`
chatpymol_user_commands = json.loads(chatpymol_user_commands_json)
chatpymol_user_warnings = []
chatpymol_user_error_markers = (
    "error", "traceback", "nameerror", "syntaxerror",
    "exception", "invalid", "not found", "unrecognized"
)
for chatpymol_user_command in chatpymol_user_commands:
    try:
        chatpymol_user_feedback = io.StringIO()
        with contextlib.redirect_stdout(chatpymol_user_feedback), contextlib.redirect_stderr(chatpymol_user_feedback):
            _p.cmd.do(chatpymol_user_command, log=0, echo=0)
        chatpymol_user_feedback_text = chatpymol_user_feedback.getvalue().strip()
        if any(marker in chatpymol_user_feedback_text.lower() for marker in chatpymol_user_error_markers):
            chatpymol_user_warnings.append({
                "command": chatpymol_user_command,
                "error": chatpymol_user_feedback_text[-500:]
            })
    except Exception as chatpymol_user_error:
        chatpymol_user_warnings.append({
            "command": chatpymol_user_command,
            "error": str(chatpymol_user_error)
        })
chatpymol_reserved_width = chatpymol_gui_width
_p.cmd.set("internal_gui", 1)
_p.cmd.set("internal_gui_width", chatpymol_gui_width)
_p.cmd.set("internal_gui_control_size", ${NATIVE_GUI_CONTROL_SIZE})
_p.cmd.set("internal_gui_mode", 0)
_p.cmd.set("seq_view", 1 if chatpymol_sequence_visible else 0)
try:
    _p.reshape(chatpymol_width, chatpymol_height, 1)
except Exception:
    pass
_p._cmd.glViewport(0, 0, chatpymol_width, chatpymol_height)
_p.cmd.viewport(max(1, chatpymol_width-chatpymol_reserved_width), chatpymol_height)
_p.idle()
_p.draw()
json.dumps(chatpymol_user_warnings)
`);
        return JSON.parse(String(encodedWarnings || "[]"));
      });
      if (commandWarnings.length) {
        throw new Error(
          commandWarnings[0].error || t("命令未执行")
        );
      }
      appliedPmlRef.current = appendPmlCommands(
        appliedPmlRef.current,
        value
      );
      onNativeCommands?.(value, { replay: false });
      showFeedback(
        label ? `${t("已应用")} · ${label}` : t("操作已应用")
      );
      if (commands.some(commandAffectsSelection)) {
        await refreshSelection();
      }
    } catch (error) {
      showFeedback(
        `${t("命令未执行")} · ${String(error.message || error).slice(0, 180)}`
      );
    }
  }

  async function runSelectionAction(action) {
    if (!activeSelection?.expression) return;
    await runEditorCommand(
      action.command(activeSelection.expression),
      `${t(action.label)} · ${t("当前选择")}`
    );
  }

  async function changeSelectionMode(nextValue) {
    const nextMode = normalizeSelectionMode(Number(nextValue));
    selectionModeRef.current = nextMode;
    setSelectionMode(nextMode);
    setActiveSelection(null);
    setSelectionActionsOpen(false);
    writePreference("chatpymol.selection-mode", String(nextMode));
    await enqueue(async () => {
      const runtime = runtimeRef.current;
      if (!runtime) return;
      runtime.globals.set("chatpymol_next_selection_mode", nextMode);
      await runtime.runPythonAsync(`
_p.cmd.set("mouse_selection_mode", chatpymol_next_selection_mode)
try:
    _p.cmd.delete("sele")
except Exception:
    pass
_p.idle()
_p.draw()
`);
    });
    showFeedback(
      `${t("选择模式")} · ${t(
        SELECTION_MODES.find((item) => item.value === nextMode)?.label ||
          "残基"
      )}`
    );
  }

  async function clearSelection() {
    const selectionName = activeSelection?.name || "sele";
    setActiveSelection(null);
    setSelectionActionsOpen(false);
    await enqueue(async () => {
      const runtime = runtimeRef.current;
      if (!runtime) return;
      runtime.globals.set("chatpymol_selection_to_clear", selectionName);
      await runtime.runPythonAsync(`
try:
    _p.cmd.delete(chatpymol_selection_to_clear)
except Exception:
    pass
_p.idle()
_p.draw()
`);
    });
  }

  async function changeViewerChrome(nextSequenceVisible) {
    const sequenceChanged =
      nextSequenceVisible !== sequenceVisibleRef.current;
    try {
      await applyViewerChrome(nextSequenceVisible);
      if (sequenceChanged) {
        showFeedback(
          nextSequenceVisible ? t("序列已显示") : t("序列已隐藏")
        );
      }
    } catch (error) {
      setState({ kind: "error", progress: 0, label: error.message });
    }
  }

  async function executeCommand(event) {
    event?.preventDefault();
    const value = command.trim();
    if (!value || !runtimeRef.current || !isReady) return;
    setCommand("");
    await runEditorCommand(value, value);
  }

  async function exportFile(kind) {
    if (!runtimeRef.current || !isReady) return;
    setState({
      kind: "exporting",
      progress: 100,
      label: kind === "pse" ? t("正在生成 PSE") : t("正在生成 PNG")
    });
    try {
      const bytes = await enqueue(async () => {
        const runtime = runtimeRef.current;
        if (kind === "pse") {
          await runtime.runPythonAsync('_p.cmd.save("/chatpymol-scene.pse")');
          return runtime.FS.readFile("/chatpymol-scene.pse");
        }
        await runtime.runPythonAsync(
          '_p.cmd.png("/chatpymol-scene.png", ray=1)'
        );
        return runtime.FS.readFile("/chatpymol-scene.png");
      });
      downloadBytes(
        bytes,
        kind === "pse"
          ? `${exportName || "chatpymol-scene"}.pse`
          : `${exportName || "chatpymol-scene"}.png`,
        kind === "pse" ? "application/octet-stream" : "image/png"
      );
      const commandWarnings = renderWarningsRef.current;
      setState({
        kind: commandWarnings.length ? "warning" : "ready",
        progress: 100,
        label: commandWarnings.length
          ? language === "en"
            ? `${commandWarnings.length} command(s) were not applied · ${versionLabel(versionId)}`
            : `${commandWarnings.length} 条命令未执行 · ${versionLabel(versionId)}`
          : language === "en"
            ? `Native PyMOL · ${versionLabel(versionId)}`
            : `原生 PyMOL · ${versionLabel(versionId)}`
      });
    } catch (error) {
      setState({ kind: "error", progress: 0, label: error.message });
    }
  }

  const visibleRevision =
    Number.isFinite(Number(revision)) && Number(revision) > 0
      ? Number(revision)
      : Number(String(versionId || "").match(/^v(\d+)/)?.[1] || 0);
  const saveStatusLabel =
    autoSaveStatus === "saving"
      ? t("正在自动保存")
      : autoSaveStatus === "saved"
        ? t("已自动保存")
        : autoSaveStatus === "pending"
          ? t("等待自动保存")
          : autoSaveStatus === "error"
            ? t("自动保存失败")
            : "";

  return (
    <div className="native-pymol">
      <div className="native-pymol-toolbar">
        <div>
          <i className={`native-status native-status-${state.kind}`} />
          <strong>PyMOL</strong>
          {visibleRevision > 0 && (
            <span className="native-pymol-version">v{visibleRevision}</span>
          )}
          {saveStatusLabel && autoSaveStatus !== "error" && (
            <span
              className={`native-save-state native-save-state-${autoSaveStatus}`}
              title={saveStatusLabel}
            >
              {autoSaveStatus === "saving" && (
                <LoaderCircle className="spin" size={10} />
              )}
              {saveStatusLabel}
            </span>
          )}
          {autoSaveStatus === "error" && (
            <button
              type="button"
              className="native-save-retry"
              onClick={() => onRetryAutoSave?.()}
              disabled={typeof onRetryAutoSave !== "function"}
              title={autoSaveError || t("自动保存失败，点击重试")}
              aria-label={t("自动保存失败，点击重试")}
            >
              <RefreshCw size={10} />
              <span>{t("自动保存失败")}</span>
            </button>
          )}
          {state.kind === "warning" && (
            <span
              title={
                state.kind === "warning"
                  ? renderWarningsRef.current
                      .map((item) => `${item.command}: ${item.error}`)
                      .join("\n")
                  : undefined
              }
            >
              {state.label}
            </span>
          )}
        </div>
        <div className="native-pymol-toolbar-actions">
          <button
            type="button"
            onClick={onUndo}
            disabled={!isReady || !canUndo}
            title={t("撤销")}
            aria-label={t("撤销")}
          >
            <Undo2 size={14} />
          </button>
          <button
            type="button"
            onClick={onRedo}
            disabled={!isReady || !canRedo}
            title={t("重做")}
            aria-label={t("重做")}
          >
            <Redo2 size={14} />
          </button>
          <i className="native-toolbar-divider" />
          <button
            type="button"
            className={sequenceVisible ? "active" : ""}
            onClick={() => changeViewerChrome(!sequenceVisible)}
            disabled={!isReady}
            title={
              sequenceVisible ? t("隐藏序列") : t("显示序列")
            }
            aria-label={
              sequenceVisible ? t("隐藏序列") : t("显示序列")
            }
          >
            <ListTree size={14} />
          </button>
          <i className="native-toolbar-divider" />
          <details className="native-export-menu">
            <summary
              className="native-export-trigger"
              aria-label={t("下载")}
              title={t("下载")}
            >
              <Download size={14} />
              <ChevronDown size={9} />
            </summary>
            <div className="native-export-popover">
              {typeof onDownloadStructure === "function" && (
                <button
                  type="button"
                  onClick={(event) => {
                    event.currentTarget.closest("details")?.removeAttribute("open");
                    onDownloadStructure();
                  }}
                >
                  <FileBox size={14} />
                  <span className="native-export-copy">
                    <strong>{t("原始结构文件")}</strong>
                    <small>{t("原子坐标，不含配色与视角")}</small>
                  </span>
                </button>
              )}
              <button
                type="button"
                onClick={(event) => {
                  event.currentTarget.closest("details")?.removeAttribute("open");
                  onDownloadPml?.();
                }}
                disabled={typeof onDownloadPml !== "function"}
              >
                <FileCode2 size={14} />
                <span className="native-export-copy">
                  <strong>{t("可复现脚本 PML")}</strong>
                  <small>{t("可阅读可修改的 PyMOL 命令")}</small>
                </span>
              </button>
              <button
                type="button"
                onClick={(event) => {
                  event.currentTarget.closest("details")?.removeAttribute("open");
                  exportFile("pse");
                }}
                disabled={!isReady}
              >
                <Download size={14} />
                <span className="native-export-copy">
                  <strong>{t("完整 PyMOL 会话 PSE")}</strong>
                  <small>{t("结构、样式与视角一起保存")}</small>
                </span>
              </button>
            </div>
          </details>
          <button
            type="button"
            onClick={() => exportFile("png")}
            disabled={!isReady}
            aria-label={t("导出光线追踪 PNG")}
            title={t("导出光线追踪 PNG")}
          >
            <ImageDown size={14} />
          </button>
        </div>
      </div>

      <div ref={shellRef} className="native-pymol-canvas-shell">
        <canvas
          id="canvas"
          ref={canvasRef}
          tabIndex="0"
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerCancel={handlePointerUp}
          onWheel={handleWheel}
          onKeyDown={handleKeyDown}
          onContextMenu={(event) => event.preventDefault()}
          aria-label={t("PyMOL 原生分子编辑画布")}
        />
        {feedback && (
          <div className="native-pymol-feedback" role="status">
            {feedback}
          </div>
        )}
        {false && isReady && (
          <section
            className={`native-selection-dock ${
              activeSelection ? "has-selection" : ""
            }`}
            aria-label={t("选择与编辑")}
          >
            <div className="native-selection-main">
              <MousePointer2 size={14} />
              <select
                value={selectionMode}
                onChange={(event) => changeSelectionMode(event.target.value)}
                title={t("选择模式")}
                aria-label={t("选择模式")}
              >
                {SELECTION_MODES.map((mode) => (
                  <option key={mode.value} value={mode.value}>
                    {t(mode.label)}
                  </option>
                ))}
              </select>
              {activeSelection ? (
                <button
                  type="button"
                  className="native-selection-summary"
                  onClick={() =>
                    setSelectionActionsOpen((current) => !current)
                  }
                  aria-expanded={selectionActionsOpen}
                >
                  <span>{selectionSummary(activeSelection, selectionMode, t)}</span>
                  <small>{t("编辑")}</small>
                </button>
              ) : (
                <span className="native-selection-hint">
                  {t("单击蛋白即可选择并编辑")}
                </span>
              )}
              {activeSelection && (
                <button
                  type="button"
                  className="native-selection-clear"
                  onClick={clearSelection}
                  title={t("清除选择")}
                  aria-label={t("清除选择")}
                >
                  <X size={13} />
                </button>
              )}
            </div>

            {activeSelection && selectionActionsOpen && (
              <div className="native-selection-actions">
                <div className="native-selection-actions-title">
                  <strong>{t("编辑当前选择")}</strong>
                  <span>{activeSelection.count} {t("个原子")}</span>
                </div>
                <span>{t("显示")}</span>
                <div className="native-object-representations">
                  {REPRESENTATION_ACTIONS.map((action) => (
                    <button
                      type="button"
                      key={action.label}
                      onClick={() => runSelectionAction(action)}
                    >
                      {t(action.label)}
                    </button>
                  ))}
                </div>
                <span>{t("颜色")}</span>
                <div className="native-object-colors">
                  {COLOR_ACTIONS.map((action) => (
                    <button
                      type="button"
                      key={action.label}
                      style={{ "--swatch": action.swatch }}
                      onClick={() => runSelectionAction(action)}
                      title={t(action.label)}
                      aria-label={t(action.label)}
                    />
                  ))}
                </div>
                <div className="native-object-secondary">
                  <button
                    type="button"
                    onClick={() => runSelectionAction(QUICK_ACTIONS.zoom)}
                  >
                    <Focus size={13} />
                    {t("聚焦")}
                  </button>
                  <button
                    type="button"
                    onClick={() => runSelectionAction(QUICK_ACTIONS.hide)}
                  >
                    <EyeOff size={13} />
                    {t("隐藏")}
                  </button>
                </div>
              </div>
            )}
          </section>
        )}
        {false && isReady && (
          <aside className="native-object-panel" aria-label={t("现代对象面板")}>
            <header>
              <div>
                <Box size={14} />
                <strong>{t("场景对象")}</strong>
              </div>
              <button
                type="button"
                onClick={refreshObjects}
                disabled={objectsLoading}
                title={t("刷新对象")}
                aria-label={t("刷新对象")}
              >
                <RefreshCw className={objectsLoading ? "spin" : ""} size={13} />
              </button>
            </header>

            <div className="native-object-list">
              {!sceneObjects.length && (
                <p>{objectsLoading ? t("正在读取对象") : t("暂无可编辑对象")}</p>
              )}
              {sceneObjects.map((object) => (
                <article
                  className={`native-object-card ${object.enabled ? "" : "is-disabled"}`}
                  key={object.name}
                >
                  <div className="native-object-row">
                    <button
                      type="button"
                      className="native-object-visibility"
                      onClick={() =>
                        runEditorCommand(
                          `${object.enabled ? "disable" : "enable"} ${selectorValue(object.name)}`,
                          `${object.enabled ? t("隐藏对象") : t("显示对象")} · ${object.name}`
                        )
                      }
                      title={object.enabled ? t("隐藏对象") : t("显示对象")}
                      aria-label={`${object.enabled ? t("隐藏对象") : t("显示对象")} ${object.name}`}
                    >
                      {object.enabled ? <Eye size={14} /> : <EyeOff size={14} />}
                    </button>
                    <button
                      type="button"
                      className="native-object-name"
                      onClick={() =>
                        runEditorCommand(
                          `zoom ${objectExpression(object.name)}, 5`,
                          `${t("聚焦")} · ${object.name}`
                        )
                      }
                    >
                      <span title={object.name}>{object.name}</span>
                    </button>
                  </div>

                  <div className="native-object-tabs">
                    {OBJECT_PANEL_SECTIONS.map((section) => {
                      const menuKey = `${object.name}::${section.key}`;
                      return (
                        <button
                          type="button"
                          key={section.key}
                          className={openObjectMenu === menuKey ? "active" : ""}
                          onClick={() =>
                            setOpenObjectMenu((current) =>
                              current === menuKey ? "" : menuKey
                            )
                          }
                          title={t(section.label)}
                          aria-expanded={openObjectMenu === menuKey}
                        >
                          {t(section.label)}
                          <ChevronDown size={10} />
                        </button>
                      );
                    })}
                  </div>

                  {OBJECT_PANEL_SECTIONS.map((section) => {
                    const menuKey = `${object.name}::${section.key}`;
                    if (openObjectMenu !== menuKey) return null;
                    return (
                      <div
                        className={`native-object-menu native-object-menu-${section.key}`}
                        key={section.key}
                      >
                        {section.actions.map((action) => (
                          <button
                            type="button"
                            key={action.label}
                            className={action.swatch ? "is-swatch" : ""}
                            style={action.swatch ? { "--swatch": action.swatch } : undefined}
                            onClick={() =>
                              runEditorCommand(
                                action.command(objectExpression(object.name)),
                                `${t(action.label)} · ${object.name}`
                              )
                            }
                            title={t(action.label)}
                          >
                            {action.swatch && <i />}
                            <span>{t(action.label)}</span>
                          </button>
                        ))}
                      </div>
                    );
                  })}
                </article>
              ))}
            </div>

          </aside>
        )}
        {(state.kind === "loading" || state.kind === "loading-scene") && (
          <div className="native-pymol-loading">
            <LoaderCircle className="spin" size={19} />
            <strong>{state.label}</strong>
            <div aria-hidden="true">
              <i style={{ width: `${state.progress}%` }} />
            </div>
            <span>{t("首次打开通常需要一些时间，请保持页面开启。")}</span>
          </div>
        )}
        {state.kind === "empty" && (
          <div className="native-pymol-empty" aria-label={state.label} />
        )}
        {state.kind === "error" && (
          <div className="native-pymol-error">
            <TriangleAlert size={21} />
            <strong>{state.label}</strong>
            <span>{t("请使用最新版 Chrome/Edge；如果仍未启动，请重新加载。")}</span>
            <button type="button" onClick={() => window.location.reload()}>
              {t("重新加载")}
            </button>
          </div>
        )}
      </div>

      <form className="native-pymol-command" onSubmit={executeCommand}>
        <TerminalSquare size={14} />
        <span>PyMOL&gt;</span>
        <input
          ref={commandInputRef}
          value={command}
          onChange={(event) => setCommand(event.target.value)}
          placeholder={t("输入支持的 PyMOL 2 命令")}
          disabled={!isReady}
          spellCheck="false"
        />
        <button
          type="submit"
          disabled={!command.trim() || !isReady}
          aria-label={t("执行命令")}
        >
          <Play size={13} />
        </button>
      </form>
    </div>
  );
}

function getPyodide() {
  if (!pyodidePromise) {
    pyodidePromise = loadScript(`${PYODIDE_BASE}pyodide.js`).then(() =>
      window.loadPyodide({ indexURL: PYODIDE_BASE })
    );
  }
  return pyodidePromise;
}

function loadScript(src) {
  const existing = document.querySelector(
    `script[data-chatpymol-pyodide="${src}"]`
  );
  if (existing) {
    if (window.loadPyodide) return Promise.resolve();
    return new Promise((resolve, reject) => {
      existing.addEventListener("load", resolve, { once: true });
      existing.addEventListener("error", reject, { once: true });
    });
  }
  return new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = src;
    script.async = true;
    script.dataset.chatpymolPyodide = src;
    script.addEventListener("load", resolve, { once: true });
    script.addEventListener(
      "error",
      () => reject(new Error("Pyodide CDN 加载失败")),
      { once: true }
    );
    document.head.appendChild(script);
  });
}

function sizeCanvas(canvas, shell) {
  const rect = shell.getBoundingClientRect();
  const width = Math.max(440, Math.floor(rect.width || 620));
  const height = Math.max(360, Math.floor(rect.height || 600));
  if (canvas.width !== width) canvas.width = width;
  if (canvas.height !== height) canvas.height = height;
  fitCanvasToShell(canvas, shell);
}

function fitCanvasToShell(canvas, shell) {
  const rect = shell.getBoundingClientRect();
  if (!rect.width || !rect.height || !canvas.width || !canvas.height) return;
  const scale = Math.min(rect.width / canvas.width, rect.height / canvas.height);
  const displayWidth = Math.max(1, Math.floor(canvas.width * scale));
  const displayHeight = Math.max(1, Math.floor(canvas.height * scale));
  const offsetX = Math.max(0, Math.floor((rect.width - displayWidth) / 2));
  const offsetY = Math.max(0, Math.floor((rect.height - displayHeight) / 2));
  const rightOffset = Math.max(0, Math.ceil(rect.width - displayWidth - offsetX));
  const bottomOffset = Math.max(0, Math.ceil(rect.height - displayHeight - offsetY));
  const panelWidth = Math.max(1, nativeGuiWidth(canvas.width) * scale);
  canvas.style.width = `${displayWidth}px`;
  canvas.style.height = `${displayHeight}px`;
  shell.style.setProperty("--native-canvas-left", `${offsetX}px`);
  shell.style.setProperty("--native-canvas-top", `${offsetY}px`);
  shell.style.setProperty("--native-canvas-right", `${rightOffset}px`);
  shell.style.setProperty("--native-canvas-bottom", `${bottomOffset}px`);
  shell.style.setProperty("--native-canvas-height", `${displayHeight}px`);
  shell.style.setProperty("--native-panel-width", `${panelWidth}px`);
}

function nativeGuiWidth(width) {
  return Math.min(230, Math.max(178, Math.round(width * 0.34)));
}

function setDimensions(runtime, width, height, guiWidth) {
  runtime.globals.set("chatpymol_width", width);
  runtime.globals.set("chatpymol_height", height);
  runtime.globals.set("chatpymol_gui_width", guiWidth);
  runtime.globals.set("chatpymol_panel_visible", true);
  runtime.globals.set("chatpymol_reserved_width", guiWidth);
}

function modifierMask(event) {
  return (
    (event.shiftKey ? 1 : 0) |
    (event.ctrlKey || event.metaKey ? 2 : 0) |
    (event.altKey ? 4 : 0)
  );
}

function encodePyMOLKey(event) {
  const special = {
    ArrowLeft: 100,
    ArrowUp: 101,
    ArrowRight: 102,
    ArrowDown: 103,
    PageUp: 104,
    PageDown: 105,
    Home: 106,
    End: 107,
    Insert: 108
  };
  if (special[event.key]) {
    return { code: special[event.key], state: -2 };
  }
  const control = {
    Backspace: 8,
    Tab: 9,
    Enter: 13,
    Escape: 27,
    Delete: 127
  };
  const code =
    control[event.key] ??
    (event.key.length === 1 ? event.key.charCodeAt(0) : null);
  if (code == null || code > 255) return null;
  return { code, state: -1 };
}

function objectExpression(name) {
  return `(model ${selectorValue(name)})`;
}

function normalizeSelectionMode(value) {
  return SELECTION_MODES.some((mode) => mode.value === value) ? value : 1;
}

function selectorValue(value) {
  const text = String(value ?? "");
  if (!text) return '""';
  if (/^[a-zA-Z0-9_.+\-]+$/.test(text)) return text;
  return `"${text.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

function scopedSelection(model, segi, chain, resi) {
  const parts = [objectExpression(model)];
  if (segi) parts.push(`segi ${selectorValue(segi)}`);
  parts.push(`chain ${selectorValue(chain)}`);
  if (resi != null) parts.push(`resi ${selectorValue(resi)}`);
  return `(${parts.join(" and ")})`;
}

function selectionExpression(selection, mode) {
  if (mode === 4) {
    return (selection.objects || [])
      .map((name) => objectExpression(name))
      .join(" or ") || "sele";
  }
  if (mode === 2) {
    return (selection.chains || [])
      .map(([model, segi, chain]) => scopedSelection(model, segi, chain))
      .join(" or ") || "sele";
  }
  if (mode === 1) {
    return (selection.residues || [])
      .map(([model, segi, chain, , resi]) =>
        scopedSelection(model, segi, chain, resi)
      )
      .join(" or ") || "sele";
  }
  const byObject = new Map();
  for (const [model, index] of selection.atoms || []) {
    if (!byObject.has(model)) byObject.set(model, []);
    byObject.get(model).push(index);
  }
  return [...byObject.entries()]
    .map(
      ([model, indices]) =>
        `(${objectExpression(model)} and index ${indices.join("+")})`
    )
    .join(" or ") || "sele";
}

function selectionSummary(selection, mode, t) {
  const first = selection.first || [];
  const [, , chain, resn, resi, atomName] = first;
  if (mode === 4) {
    return (selection.objects || []).join(", ") || t("当前选择");
  }
  if (mode === 2) {
    const count = selection.chains?.length || 1;
    return count > 1
      ? `${count} ${t("条链")}`
      : `${chain || t("未命名")} ${t("链")}`;
  }
  if (mode === 1) {
    const count = selection.residues?.length || 1;
    return count > 1
      ? `${count} ${t("个残基")}`
      : `${resn || ""} ${chain ? `${chain}:` : ""}${resi || ""}`.trim();
  }
  return `${resn || ""} ${chain ? `${chain}:` : ""}${resi || ""} · ${atomName || t("原子")}`.trim();
}

function appendPmlCommands(pml, commands) {
  const addition = String(commands || "").trim();
  if (!addition) return String(pml || "");
  return `${String(pml || "").trimEnd()}\n\n${addition}\n`;
}

function commandAffectsSelection(command) {
  return /^(?:select|deselect|delete\s+(?:sele|pk\d+)\b)\b/i.test(
    String(command || "").trim()
  );
}

function readPreference(key, fallback) {
  try {
    return window.localStorage.getItem(key) || fallback;
  } catch {
    return fallback;
  }
}

function readInitialSequencePreference() {
  const preferenceVersion = readPreference(
    "chatpymol.sequence-preference-version",
    ""
  );
  if (preferenceVersion !== SEQUENCE_PREFERENCE_VERSION) {
    writePreference("chatpymol.sequence-view", "on");
    writePreference(
      "chatpymol.sequence-preference-version",
      SEQUENCE_PREFERENCE_VERSION
    );
    return true;
  }
  return readPreference("chatpymol.sequence-view", "on") !== "off";
}

function writePreference(key, value) {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // Preferences are optional in private browsing modes.
  }
}

function safeFilename(value) {
  return String(value || "structure.pdb").replace(
    /[^a-zA-Z0-9._-]/g,
    "_"
  );
}

function versionLabel(versionId) {
  const revision = String(versionId || "").match(/^v(\d+)/)?.[1];
  return revision ? `v${Number(revision)}` : "scene";
}

function renderableCommands(pml) {
  return interactiveCommands(pml).filter(
    (command) =>
      !/^_\s+/.test(command) &&
      !/^(load|fetch|run|save|png|mpng|quit|reinitialize|system|shell)\b/i.test(command)
  );
}

function sceneKeyFor(projectId, structures) {
  return `${projectId}|${structures
    .map((item) =>
      [item.id, item.sha256, item.objectName, item.filename].join(":")
    )
    .join("|")}`;
}

function pmlCommandDelta(previousPml, nextPml) {
  const previous = renderableCommands(previousPml);
  const next = renderableCommands(nextPml);
  if (
    previous.length > next.length ||
    previous.some((command, index) => command !== next[index])
  ) {
    return null;
  }
  return next.slice(previous.length);
}

function isIncrementalCommand(command) {
  const value = String(command || "").trim();
  if (
    /^(?:color|set_color|bg_color|spectrum|show|hide|as|enable|disable|zoom|orient|center|origin|set_view|select|deselect|label|unlabel)\b/i.test(
      value
    ) ||
    /^util\.(?:cbc|cbac|chainbow|rainbow)\b/i.test(value)
  ) {
    return true;
  }
  const setting = value.match(/^(?:set|unset)\s+([^,\s]+)/i)?.[1]?.toLowerCase();
  return Boolean(
    setting &&
      /^(?:ray_opaque_background|cartoon_color|ribbon_color|surface_color|stick_color|sphere_color|label_color|dash_color|mesh_color|line_color|transparency|cartoon_transparency|surface_transparency|stick_transparency|sphere_transparency|label_size|label_color|ambient|specular|shininess|reflect|fog|fog_start|depth_cue|two_sided_lighting|orthoscopic|ray_trace_mode|ray_shadows|antialias)$/.test(
        setting
      )
  );
}

function interactiveCommands(pml) {
  const commands = [];
  let pending = "";
  for (const rawLine of String(pml || "").split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    pending += (pending ? " " : "") + line.replace(/\\$/, "").trim();
    if (line.endsWith("\\")) continue;
    for (const part of pending.split(";")) {
      const command = part.trim();
      if (command) commands.push(command);
    }
    pending = "";
  }
  return commands;
}

function cleanNativeLog(value) {
  return String(value || "")
    .split(/\r?\n/)
    .map((line) => line.trimEnd())
    .filter(
      (line) =>
        line.trim() &&
        !/^log_(open|close)\b/i.test(line.trim()) &&
        !/^#/.test(line.trim()) &&
        !/^_\s+/.test(line.trim())
    )
    .join("\n")
    .trim();
}

function downloadBytes(bytes, filename, type) {
  const blob = new Blob([bytes], { type });
  const href = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = href;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(href);
}
