import {
  Bot,
  ChevronLeft,
  ChevronRight,
  CircleHelp,
  MonitorPlay,
  MousePointer2,
  Play,
  Plus,
  Send,
  SquareTerminal,
  X
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";

export const ONBOARDING_STORAGE_KEY = "chatpymol.onboarding.v1";

const TUTORIALS = [
  {
    id: "chat",
    icon: MonitorPlay,
    title: "聊天与人工协作",
    description: "从空白对话开始，让 AI 载入、修改结构，再用 PyMOL 原生工具继续编辑。",
    duration: "约 40 秒",
    src: "/tutorials/chat-collaboration.mp4",
    poster: "/tutorials/chat-collaboration.jpg"
  },
];

const TOUR_STEPS = [
  {
    target: "new-chat",
    icon: Plus,
    eyebrow: "第一步",
    title: "为每个课题新建独立对话",
    description: "一个对话就是一个可追溯工作区，可以包含多个蛋白、核酸和配体。"
  },
  {
    target: "composer",
    icon: Send,
    eyebrow: "自然语言",
    title: "描述你想看到的结构",
    description: "直接输入 PDB ID 和修改要求，也可以从回形针上传 PDB 或 mmCIF。"
  },
  {
    target: "workspace-panel",
    icon: MousePointer2,
    eyebrow: "人工协作",
    title: "在右侧继续用 PyMOL 编辑",
    description: "右侧会随所选版本同步渲染；原生工具继续负责选择、表示、颜色、标签和测距，结果可随时导出。"
  },
  {
    target: "local-agent",
    icon: SquareTerminal,
    eyebrow: "本机私有",
    title: "也可以连接本地 AI Agent",
    description: "通过 CLI 与 MCP 接入 Codex、Claude Code 或其他支持本地 MCP 的 Agent。"
  }
];

export function OnboardingDialog({
  mode,
  t,
  onClose,
  onStartTour,
  onOpenVideos
}) {
  const [activeVideoId, setActiveVideoId] = useState("chat");
  const dialogRef = useRef(null);
  const activeVideo = useMemo(
    () => TUTORIALS.find((item) => item.id === activeVideoId) || TUTORIALS[0],
    [activeVideoId]
  );

  useEffect(() => {
    if (!mode) return undefined;
    const previousFocus = document.activeElement;
    const focusFrame = window.requestAnimationFrame(() => dialogRef.current?.focus());
    function handleKeyDown(event) {
      if (event.key === "Escape") onClose();
      if (event.key !== "Tab" || !dialogRef.current) return;
      const focusable = Array.from(
        dialogRef.current.querySelectorAll(
          'button:not([disabled]), a[href], video[controls], input:not([disabled]), [tabindex]:not([tabindex="-1"])'
        )
      );
      if (!focusable.length) {
        event.preventDefault();
        return;
      }
      const first = focusable[0];
      const last = focusable.at(-1);
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.cancelAnimationFrame(focusFrame);
      window.removeEventListener("keydown", handleKeyDown);
      previousFocus?.focus?.();
    };
  }, [mode, onClose]);

  if (!mode) return null;

  return createPortal(
    <div
      className="onboarding-backdrop"
      onPointerDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      {mode === "welcome" ? (
        <section
          ref={dialogRef}
          tabIndex={-1}
          className="onboarding-dialog onboarding-welcome"
          role="dialog"
          aria-modal="true"
          aria-labelledby="chatpymol-welcome-title"
        >
          <button
            type="button"
            className="onboarding-close"
            onClick={onClose}
            aria-label={t("关闭")}
          >
            <X size={17} />
          </button>
          <span className="onboarding-kicker">CHATPYMOL</span>
          <div className="onboarding-welcome-mark">
            <Bot size={25} />
          </div>
          <h2 id="chatpymol-welcome-title">{t("欢迎来到 ChatPyMOL")}</h2>
          <p className="onboarding-lead">
            {t("用自然语言和 PyMOL 一起编辑结构。")}
          </p>
          <div className="onboarding-welcome-actions">
            <button type="button" className="onboarding-quiet" onClick={onOpenVideos}>
              <Play size={15} />
              {t("观看演示")}
            </button>
            <button type="button" className="onboarding-primary" onClick={onStartTour}>
              {t("开始页面引导")}
              <ChevronRight size={16} />
            </button>
          </div>
          <button type="button" className="onboarding-later" onClick={onClose}>
            {t("稍后再看")}
          </button>
        </section>
      ) : (
        <section
          ref={dialogRef}
          tabIndex={-1}
          className="onboarding-dialog onboarding-library"
          role="dialog"
          aria-modal="true"
          aria-labelledby="chatpymol-guide-title"
        >
          <header className="onboarding-library-header">
            <span className="onboarding-header-icon"><CircleHelp size={19} /></span>
            <div>
              <h2 id="chatpymol-guide-title">{t("新手指引")}</h2>
              <p>{t("通过一段真实操作，快速了解网页协作流程。")}</p>
            </div>
            <button
              type="button"
              className="onboarding-close"
              onClick={onClose}
              aria-label={t("关闭")}
            >
              <X size={17} />
            </button>
          </header>

          <div className="onboarding-video-tabs" aria-label={t("教程视频")}>
            {TUTORIALS.map((item) => {
              const Icon = item.icon;
              return (
                <button
                  key={item.id}
                  type="button"
                  aria-pressed={item.id === activeVideo.id}
                  aria-controls="chatpymol-tutorial-video"
                  className={item.id === activeVideo.id ? "active" : ""}
                  onClick={() => setActiveVideoId(item.id)}
                >
                  <span><Icon size={17} /></span>
                  <div>
                    <strong>{t(item.title)}</strong>
                    <small>{t(item.duration)}</small>
                  </div>
                </button>
              );
            })}
          </div>

          <div
            id="chatpymol-tutorial-video"
            className="onboarding-video-stage"
            role="region"
            aria-label={t(activeVideo.title)}
          >
            <video
              key={activeVideo.id}
              controls
              playsInline
              preload="metadata"
              poster={activeVideo.poster}
              aria-label={t(activeVideo.title)}
            >
              <source src={activeVideo.src} type="video/mp4" />
            </video>
          </div>

          <div className="onboarding-video-info">
            <div>
              <strong>{t(activeVideo.title)}</strong>
              <p>{t(activeVideo.description)}</p>
            </div>
            <button type="button" onClick={onStartTour}>
              <MousePointer2 size={15} />
              {t("重播页面引导")}
            </button>
          </div>
        </section>
      )}
    </div>,
    document.body
  );
}

export function SpotlightTour({ stepIndex, t, onBack, onNext, onSkip }) {
  const [rect, setRect] = useState(null);
  const step = TOUR_STEPS[stepIndex];
  const isLast = stepIndex === TOUR_STEPS.length - 1;

  useEffect(() => {
    let animationFrame;
    function updateRect() {
      const target = document.querySelector(`[data-tour="${step.target}"]`);
      if (!target) {
        setRect(null);
        return;
      }
      const next = target.getBoundingClientRect();
      const padding = 7;
      setRect({
        top: Math.max(6, next.top - padding),
        left: Math.max(6, next.left - padding),
        right: Math.min(window.innerWidth - 6, next.right + padding),
        bottom: Math.min(window.innerHeight - 6, next.bottom + padding)
      });
    }
    animationFrame = window.requestAnimationFrame(updateRect);
    window.addEventListener("resize", updateRect);
    return () => {
      window.cancelAnimationFrame(animationFrame);
      window.removeEventListener("resize", updateRect);
    };
  }, [step]);

  useEffect(() => {
    function handleKeyDown(event) {
      if (event.key === "Escape") onSkip();
      const target = event.target;
      const isEditing =
        target instanceof HTMLElement &&
        (target.isContentEditable || Boolean(target.closest("input, textarea, select")));
      if (isEditing) return;
      if (event.key === "ArrowRight") onNext();
      if (event.key === "ArrowLeft" && stepIndex > 0) onBack();
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onBack, onNext, onSkip, stepIndex]);

  const Icon = step.icon;
  const popoverStyle = getPopoverStyle(rect);
  const masks = getMaskStyles(rect);

  return createPortal(
    <div className="onboarding-tour" aria-live="polite">
      {masks.map((style, index) => (
        <div key={index} className="onboarding-mask" style={style} />
      ))}
      {rect && (
        <div
          className="onboarding-spotlight"
          style={{
            top: rect.top,
            left: rect.left,
            width: rect.right - rect.left,
            height: rect.bottom - rect.top
          }}
        />
      )}
      <section className="onboarding-tour-card" style={popoverStyle}>
        <div className="onboarding-tour-heading">
          <span><Icon size={17} /></span>
          <small>{t(step.eyebrow)} · {stepIndex + 1}/{TOUR_STEPS.length}</small>
        </div>
        <h3>{t(step.title)}</h3>
        <p>{t(step.description)}</p>
        <div className="onboarding-tour-actions">
          <button type="button" className="tour-skip" onClick={onSkip}>
            {t("跳过")}
          </button>
          <div>
            {stepIndex > 0 && (
              <button type="button" className="tour-back" onClick={onBack} aria-label={t("上一步")}>
                <ChevronLeft size={16} />
              </button>
            )}
            <button type="button" className="tour-next" onClick={onNext}>
              {t(isLast ? "完成" : "下一步")}
              {!isLast && <ChevronRight size={16} />}
            </button>
          </div>
        </div>
      </section>
    </div>,
    document.body
  );
}

function getMaskStyles(rect) {
  if (!rect) return [{ inset: 0 }];
  return [
    { top: 0, left: 0, right: 0, height: rect.top },
    { top: rect.bottom, left: 0, right: 0, bottom: 0 },
    { top: rect.top, left: 0, width: rect.left, height: rect.bottom - rect.top },
    { top: rect.top, left: rect.right, right: 0, height: rect.bottom - rect.top }
  ];
}

function getPopoverStyle(rect) {
  const margin = 14;
  const width = Math.min(330, window.innerWidth - margin * 2);
  const height = Math.min(230, window.innerHeight - margin * 2);
  if (!rect) {
    return { top: "50%", left: "50%", transform: "translate(-50%, -50%)" };
  }

  const roomRight = window.innerWidth - rect.right;
  const roomLeft = rect.left;
  let left;
  if (roomRight >= width + margin) {
    left = rect.right + margin;
  } else if (roomLeft >= width + margin) {
    left = rect.left - width - margin;
  } else {
    left = Math.max(margin, Math.min(window.innerWidth - width - margin, rect.left));
  }

  const roomBelow = window.innerHeight - rect.bottom;
  const roomAbove = rect.top;
  let top;
  if (roomBelow >= height + margin) {
    top = rect.bottom + margin;
  } else if (roomAbove >= height + margin) {
    top = rect.top - height - margin;
  } else {
    top = Math.max(
      margin,
      Math.min(window.innerHeight - height - margin, rect.top + margin)
    );
  }

  return { top, left, transform: "none" };
}
