import { chromium } from "playwright";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  chromiumLaunchOptions,
  configurePlaywrightLibraryPath
} from "./playwright-runtime.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const token = `verify_native_hybrid_${Date.now()}_abcdefghijklmnopqrstuvwxyz`;
configurePlaywrightLibraryPath();
const browser = await chromium.launch(chromiumLaunchOptions({
  headless: true,
  args: ["--no-sandbox", "--enable-unsafe-swiftshader"]
}));
const context = await browser.newContext({
  viewport: { width: 1500, height: 920 },
  deviceScaleFactor: 1,
  acceptDownloads: true
});
await context.addInitScript(({ deviceToken }) => {
  localStorage.setItem("chatpymol.device-token.v1", deviceToken);
  localStorage.setItem("chatpymol.theme", "light");
  localStorage.setItem("chatpymol.language", "zh");
  // Simulate preferences left by the earlier UI. The current UI must migrate
  // both values so the sequence and classic controls are actually legible.
  localStorage.setItem("chatpymol.sequence-view", "off");
  localStorage.setItem("chatpymol.right-width", "180");
}, { deviceToken: token });

const page = await context.newPage();
const pageErrors = [];
const failedRequests = [];
page.on("pageerror", (error) => pageErrors.push(error.message));
page.on("requestfailed", (request) => {
  if (!request.url().includes("favicon")) {
    failedRequests.push(`${request.method()} ${request.url()}`);
  }
});

await page.goto("http://127.0.0.1:8787", { waitUntil: "networkidle" });
await page.getByRole("button", { name: "新建对话" }).waitFor();
await page.locator('input[type="file"]').setInputFiles(
  path.join(root, "scripts/fixtures/mini.pdb")
);
await page.locator(".clean-right-panel").waitFor();
await page.locator(".native-pymol-loading").waitFor({
  state: "detached",
  timeout: 120_000
});
await page.locator(".native-status-ready").waitFor({ timeout: 120_000 });

if (await page.locator(".clean-right-header").count()) {
  throw new Error("The redundant outer viewer toolbar is still present");
}
const pymolToolbar = page.locator(".native-pymol-toolbar");
if ((await pymolToolbar.locator(".native-export-trigger").count()) !== 1) {
  throw new Error("The PyMOL toolbar must expose one consolidated download menu");
}
if ((await pymolToolbar.getByLabel("导出光线追踪 PNG").count()) !== 1) {
  throw new Error("PNG export must appear exactly once in the PyMOL toolbar");
}
if ((await pymolToolbar.getByText(/^v\d+$/).count()) !== 1) {
  throw new Error("The current revision is missing from the PyMOL toolbar");
}
if (
  (await pymolToolbar.getByLabel("撤销").count()) !== 1 ||
  (await pymolToolbar.getByLabel("重做").count()) !== 1 ||
  (await pymolToolbar.getByLabel("隐藏序列").count()) !== 1
) {
  throw new Error("Version, undo/redo, or sequence controls are misplaced or duplicated");
}
if (
  (await page.getByLabel("隐藏 PyMOL 原生侧栏", { exact: true }).count()) ||
  (await page.getByLabel("显示 PyMOL 原生侧栏", { exact: true }).count())
) {
  throw new Error("The classic PyMOL sidebar must not expose a hide/show toggle");
}
if ((await page.getByLabel("关闭工作区", { exact: true }).count()) !== 1) {
  throw new Error("Only the global workspace collapse control should remain");
}
if (await page.locator(".clean-scene-statusbar:not(.history)").count()) {
  throw new Error("The old duplicate current-version status bar is still visible");
}
await pymolToolbar.locator(".native-export-trigger").click();
const exportPopover = pymolToolbar.locator(".native-export-popover");
for (const text of [
  "原始结构文件",
  "原子坐标，不含配色与视角",
  "可复现脚本 PML",
  "可阅读可修改的 PyMOL 命令",
  "完整 PyMOL 会话 PSE",
  "结构、样式与视角一起保存"
]) {
  await exportPopover.getByText(text, { exact: true }).waitFor();
}
await pymolToolbar.locator(".native-export-trigger").click();

const githubLink = page.getByLabel("GitHub", { exact: true });
const issueLink = page.getByLabel("提交 Issue", { exact: true });
const emailButton = page.getByLabel("邮件联系", { exact: true });
if (
  (await githubLink.getAttribute("href")) !==
    "https://github.com/IveGotMagicBean/ChatPyMol" ||
  (await issueLink.getAttribute("href")) !==
    "https://github.com/IveGotMagicBean/ChatPyMol/issues/new?template=suggestion.yml" ||
  (await emailButton.count()) !== 1
) {
  throw new Error("GitHub, Issue, or email link is incorrect");
}
for (const externalLink of [githubLink, issueLink]) {
  if (
    (await externalLink.getAttribute("target")) !== "_blank" ||
    !(await externalLink.getAttribute("rel"))?.includes("noopener") ||
    !(await externalLink.getAttribute("rel"))?.includes("noreferrer")
  ) {
    throw new Error("External repository links must open safely in a new tab");
  }
}
await emailButton.click();
const contactDialog = page.getByRole("dialog", { name: "联系 ChatPyMOL" });
await contactDialog.waitFor();
if (
  (await contactDialog.getByRole("link", { name: "542058929@qq.com" })
    .getAttribute("href")) !== "mailto:542058929@qq.com" ||
  (await contactDialog.getByRole("button", { name: "复制邮箱地址" }).count()) !== 1
) {
  throw new Error("The email popover or copy action is incorrect");
}
await page.keyboard.press("Escape");
await contactDialog.waitFor({ state: "detached" });

const canvas = page.locator(".native-pymol-canvas-shell canvas");
const rightPanelWidth = await page.locator(".clean-right-panel").evaluate(
  (element) => element.getBoundingClientRect().width
);
if (rightPanelWidth < 440) {
  throw new Error(`Legacy right-panel width was not migrated: ${rightPanelWidth}`);
}
const migratedPreferences = await page.evaluate(() => ({
  rightWidth: Number(localStorage.getItem("chatpymol.right-width")),
  sequence: localStorage.getItem("chatpymol.sequence-view"),
  sequenceVersion: localStorage.getItem(
    "chatpymol.sequence-preference-version"
  )
}));
if (
  migratedPreferences.rightWidth < 440 ||
  migratedPreferences.sequence !== "on" ||
  migratedPreferences.sequenceVersion !== "2"
) {
  throw new Error(
    `Legacy viewer preferences were not migrated: ${JSON.stringify(migratedPreferences)}`
  );
}
const visualBeforeFileCard = await canvasVisualMetrics(page, canvas);
assertMoleculeAndNativePanel(visualBeforeFileCard, "initial scene");
const exampleFileCard = page.locator(".message-structure-card", {
  hasText: "1AKI.pdb"
}).first();
if ((await exampleFileCard.count()) !== 1) {
  throw new Error("The default example PDB file card is missing");
}
await exampleFileCard.click();
await page.waitForTimeout(350);
if (await page.locator(".clean-scene-statusbar.history").count()) {
  throw new Error("Clicking a PDB file card unexpectedly entered history mode");
}
const visualAfterFileCard = await canvasVisualMetrics(page, canvas);
assertMoleculeAndNativePanel(visualAfterFileCard, "after PDB file card");
await assertNoReplacementPanel(page, "initial load");
const backingBefore = await canvas.evaluate((element) => [
  element.width,
  element.height
]);
await assertClassicNativePanelInteractive(
  page,
  canvas,
  "initial"
);
await page.screenshot({
  path: "artifacts/native-hybrid-native-default.png",
  fullPage: true
});
await page.getByLabel("隐藏序列").click();
await page.getByLabel("显示序列").waitFor();
await page.getByLabel("显示序列").click();
await page.getByLabel("隐藏序列").waitFor();
await assertClassicNativePanelInteractive(page, canvas, "after sequence toggle");

const handle = await page.getByRole("separator", {
  name: "调整右侧栏宽度"
}).boundingBox();
await page.mouse.move(handle.x + handle.width / 2, handle.y + 120);
await page.mouse.down();
await page.mouse.move(handle.x - 80, handle.y + 120, { steps: 5 });
await page.mouse.up();
const backingAfter = await canvas.evaluate((element) => [
  element.width,
  element.height
]);
if (String(backingBefore) !== String(backingAfter)) {
  throw new Error(
    `Canvas backing changed during resize: ${backingBefore} -> ${backingAfter}`
  );
}
await assertNoReplacementPanel(page, "resized native panel");
await assertClassicNativePanelInteractive(page, canvas, "resized");
await page.screenshot({
  path: "artifacts/native-hybrid-native-resized.png",
  fullPage: true
});

const command = page.locator(".native-pymol-command input");
await command.fill("color magenta, all");
await command.press("Enter");
await page.getByText(/已应用 · color magenta, all/).waitFor();
await page.getByText("已自动保存", { exact: true }).waitFor({
  timeout: 30_000
});
if (await page.getByText(/已提交原生 PyMOL 编辑/).count()) {
  throw new Error("Native autosave leaked an internal commit message into chat");
}
const persistedWorkspace = await page.evaluate(async (deviceToken) => {
  const response = await fetch("/api/bootstrap", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ deviceToken })
  });
  if (!response.ok) throw new Error(`Bootstrap failed: ${response.status}`);
  return response.json();
}, token);
if (!persistedWorkspace.pml.includes("color magenta, all")) {
  throw new Error("Native command was not persisted by autosave");
}
if (persistedWorkspace.version.source !== "native-pymol-autosave") {
  throw new Error(
    `Unexpected autosave source: ${persistedWorkspace.version.source}`
  );
}
if (persistedWorkspace.messages.some((message) => message.mode === "manual-edit")) {
  throw new Error("Native autosave created a manual-edit chat message");
}
await page.screenshot({
  path: "artifacts/native-hybrid-final.png",
  fullPage: true
});

const metrics = await page.evaluate(() => ({
  panelMode: "native",
  sequence: localStorage.getItem("chatpymol.sequence-view"),
  customObjectPanels: document.querySelectorAll(".native-object-panel").length,
  selectionDocks: document.querySelectorAll(".native-selection-dock").length,
  overflow: document.body.scrollWidth > document.body.clientWidth
}));
if (metrics.overflow) throw new Error("Page has horizontal overflow");
if (pageErrors.length) throw new Error(`Page errors: ${pageErrors.join(" | ")}`);
if (failedRequests.length) {
  throw new Error(`Failed requests: ${failedRequests.join(" | ")}`);
}

console.log(JSON.stringify({
  token,
  rightPanelWidth,
  migratedPreferences,
  visualBeforeFileCard,
  visualAfterFileCard,
  backingBefore,
  backingAfter,
  persistedRevision: persistedWorkspace.version.revision,
  persistedSource: persistedWorkspace.version.source,
  metrics,
  pageErrors,
  failedRequests
}, null, 2));

await context.close();
await browser.close();

async function canvasVisualMetrics(page, canvas) {
  const screenshot = await canvas.screenshot({ animations: "disabled" });
  const source = `data:image/png;base64,${screenshot.toString("base64")}`;
  return page.evaluate(async (imageSource) => {
    const image = new Image();
    image.src = imageSource;
    await image.decode();
    const sample = document.createElement("canvas");
    sample.width = image.naturalWidth;
    sample.height = image.naturalHeight;
    const context = sample.getContext("2d", { willReadFrequently: true });
    context.drawImage(image, 0, 0);
    const pixels = context.getImageData(
      0,
      0,
      sample.width,
      sample.height
    ).data;
    const panelStart = Math.floor(sample.width * 0.66);
    const sideColors = new Set();
    let sideNonWhite = 0;
    let mainColored = 0;
    for (let y = 0; y < sample.height; y += 1) {
      for (let x = 0; x < sample.width; x += 1) {
        const offset = (y * sample.width + x) * 4;
        const red = pixels[offset];
        const green = pixels[offset + 1];
        const blue = pixels[offset + 2];
        if (x >= panelStart) {
          if (red < 245 || green < 245 || blue < 245) sideNonWhite += 1;
          if (sideColors.size < 512) {
            sideColors.add(`${red >> 3}:${green >> 3}:${blue >> 3}`);
          }
        } else if (
          Math.max(red, green, blue) - Math.min(red, green, blue) > 18 &&
          Math.max(red, green, blue) > 45
        ) {
          mainColored += 1;
        }
      }
    }
    return {
      width: sample.width,
      height: sample.height,
      sideNonWhite,
      sideColorBuckets: sideColors.size,
      mainColored
    };
  }, source);
}

function assertMoleculeAndNativePanel(metrics, phase) {
  if (metrics.sideNonWhite < 1_000 || metrics.sideColorBuckets < 12) {
    throw new Error(
      `Classic native panel was not painted during ${phase}: ${JSON.stringify(metrics)}`
    );
  }
  if (metrics.mainColored < 500) {
    throw new Error(
      `The molecule disappeared during ${phase}: ${JSON.stringify(metrics)}`
    );
  }
}

async function assertNoReplacementPanel(page, phase) {
  const customObjectPanels = await page.locator(".native-object-panel").count();
  const customSelectionDocks = await page.locator(".native-selection-dock").count();
  if (customObjectPanels || customSelectionDocks) {
    throw new Error(
      `Classic PyMOL layout was replaced during ${phase}: ` +
        `${customObjectPanels} object panel(s), ${customSelectionDocks} selection dock(s)`
    );
  }
}

async function nativePanelScreenshot(page, canvas) {
  const metrics = await canvas.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    const backingPanelWidth = Math.min(
      224,
      Math.max(200, Math.round(element.width * 0.34))
    );
    const cssPanelWidth = backingPanelWidth * (rect.width / element.width);
    return {
      x: rect.right - cssPanelWidth,
      y: rect.top,
      width: cssPanelWidth,
      height: rect.height
    };
  });
  return page.screenshot({
    animations: "disabled",
    clip: metrics
  });
}

async function assertClassicNativePanelInteractive(page, canvas, phase) {
  const before = await nativePanelScreenshot(page, canvas);
  const target = await canvas.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    const controlSize = 19;
    const backingX = element.width - controlSize * 5 + controlSize / 2;
    const backingY = Math.round(controlSize * 1.9);
    return {
      x: rect.left + backingX * (rect.width / element.width),
      y: rect.top + backingY * (rect.height / element.height)
    };
  });

  await page.mouse.click(target.x, target.y);
  let after = before;
  for (let attempt = 0; attempt < 15 && before.equals(after); attempt += 1) {
    await page.waitForTimeout(100);
    after = await nativePanelScreenshot(page, canvas);
  }
  if (before.equals(after)) {
    throw new Error(
      `Classic native A menu did not open during ${phase}; ` +
        "the Canvas panel may be hidden or pointer coordinates may be misaligned"
    );
  }

  await page.keyboard.press("Escape");
  await page.waitForTimeout(250);
  return before;
}
