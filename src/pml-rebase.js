const MANAGED_VIEW_BLOCK_RE =
  /# @chatpymol view-begin[\s\S]*?# @chatpymol view-end/g;

/**
 * Replays a browser-native append-only edit on top of a newer external PML.
 * Returns null when the draft changed earlier content and cannot be rebased
 * without guessing.
 */
export function rebaseNativePmlDraft(basePml, draftPml, latestPml) {
  const base = splitManagedView(basePml);
  const draft = splitManagedView(draftPml);
  const latest = splitManagedView(latestPml);
  const suffix = appendedSuffix(base.body, draft.body);
  if (suffix === null) return null;

  const viewChanged = draft.view !== base.view;
  const mergedView = viewChanged ? draft.view : latest.view;
  let mergedBody = latest.body.trimEnd();
  if (suffix.trim()) {
    mergedBody = `${mergedBody}\n\n${suffix.trim()}`;
  }
  return `${mergedBody}${mergedView ? `\n\n${mergedView}` : ""}\n`;
}

function splitManagedView(pml) {
  const text = String(pml || "");
  const matches = [...text.matchAll(MANAGED_VIEW_BLOCK_RE)];
  return {
    body: text.replace(MANAGED_VIEW_BLOCK_RE, "").trimEnd(),
    view: matches.at(-1)?.[0]?.trim() || ""
  };
}

function appendedSuffix(base, draft) {
  if (draft === base) return "";
  if (!draft.startsWith(base)) return null;
  const suffix = draft.slice(base.length);
  if (base && suffix && !/^\s/.test(suffix)) return null;
  return suffix;
}
