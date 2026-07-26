import {
  Box,
  Check,
  ChevronRight,
  History,
  LoaderCircle,
  MessageSquare,
  Plus,
  ShieldCheck,
  Sparkles
} from "lucide-react";

export function ConversationSidebar({
  conversations,
  workspace,
  versions,
  busy,
  onNew,
  onSwitch,
  onPreview,
  style,
  t
}) {
  return (
    <aside className="conversation-sidebar" style={style}>
      <div className="sidebar-product">
        <span className="sidebar-logo">
          <Box size={16} />
        </span>
        <strong>ChatPyMOL</strong>
      </div>

      <button className="new-conversation" onClick={onNew} disabled={Boolean(busy)}>
        {busy === "new-chat" ? (
          <LoaderCircle size={16} className="spin" />
        ) : (
          <Plus size={16} />
        )}
        {t("新建对话")}
      </button>

      <div className="sidebar-scroll">
        <section className="conversation-list">
          <div className="sidebar-label">{t("对话")}</div>
          {conversations.map((conversation) => {
            const active = conversation.id === workspace.project.id;
            return (
              <button
                key={conversation.id}
                className={`conversation-row ${active ? "active" : ""}`}
                onClick={() => onSwitch(conversation.id)}
              >
                <MessageSquare size={14} />
                <span>
                  <strong>{conversation.title}</strong>
                  <small>{t(conversation.preview)}</small>
                </span>
                {busy === `switch:${conversation.id}` ? (
                  <LoaderCircle size={13} className="spin" />
                ) : active ? (
                  <Check size={13} />
                ) : null}
              </button>
            );
          })}
        </section>

        <section className="sidebar-versions">
          <div className="sidebar-label">
            <span>{t("当前对话版本")}</span>
            <em>{versions.length}</em>
          </div>
          {versions.slice(0, 5).map((version) => (
            <button key={version.id} onClick={() => onPreview(version.id)}>
              <span className={`version-mini actor-${version.actor}`}>
                {version.actor === "ai" ? (
                  <Sparkles size={10} />
                ) : (
                  version.revision
                )}
              </span>
              <span>
                <strong>{friendlySummary(version.summary, t)}</strong>
                <small>{t("版本")} {version.revision}</small>
              </span>
              <ChevronRight size={12} />
            </button>
          ))}
        </section>
      </div>

      <div className="sidebar-safety">
        <ShieldCheck size={14} />
        <span>
          <strong>{t("Skill 校验已开启")}</strong>
          <small>{t("生成前匹配技能，提交前检查 PML")}</small>
        </span>
      </div>
    </aside>
  );
}

function friendlySummary(summary, t) {
  const normalized = String(summary || "场景修改")
    .replace(/^Created the initial scene$/i, "创建初始场景")
    .replace(/^Uploaded /i, "上传 ")
    .replace(/^Imported /i, "导入 ")
    .replace(/^Restored revision (\d+)$/i, "恢复到版本 $1")
    .replace(/^Edited PML$/i, "人工编辑 PML");
  return t(normalized);
}
