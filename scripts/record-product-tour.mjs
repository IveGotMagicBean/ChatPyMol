import { copyFile, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import {
  chromiumLaunchOptions,
  configurePlaywrightLibraryPath
} from "./playwright-runtime.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outputDir = path.join(root, "artifacts", "recording");
const rawDir = path.join(outputDir, "raw");
const finalVideo = path.join(outputDir, "ChatPyMOL-使用演示.webm");
const coverImage = path.join(outputDir, "ChatPyMOL-使用演示封面.png");
const timelineFile = path.join(outputDir, "timeline.json");
const diagnosticsFile = path.join(outputDir, "diagnostics.json");
const baseUrl = process.env.CHATPYMOL_URL || "http://127.0.0.1:8787";
const token = `product_tour_${Date.now()}_abcdefghijklmnopqrstuvwxyz`;

await mkdir(rawDir, { recursive: true });
configurePlaywrightLibraryPath();

const browser = await chromium.launch(
  chromiumLaunchOptions({
    headless: true,
    args: ["--no-sandbox", "--enable-unsafe-swiftshader"]
  })
);
const context = await browser.newContext({
  viewport: { width: 1600, height: 900 },
  deviceScaleFactor: 1,
  acceptDownloads: true,
  recordVideo: {
    dir: rawDir,
    size: { width: 1600, height: 900 }
  }
});
await context.addInitScript(({ deviceToken }) => {
  localStorage.setItem("chatpymol.device-token.v1", deviceToken);
  localStorage.setItem("chatpymol.theme", "light");
  localStorage.setItem("chatpymol.language", "zh");
  localStorage.setItem("chatpymol.left-width", "270");
  localStorage.setItem("chatpymol.right-width", "680");
  localStorage.setItem("chatpymol.sequence-view", "on");
}, { deviceToken: token });

const diagnostics = {
  baseUrl,
  token,
  pageErrors: [],
  failedRequests: [],
  badResponses: []
};
const timeline = [];
let tourStartedAt = 0;
let mainPage = null;
let mainVideo = null;
let recordingError = null;

try {
  // Warm the browser cache with Pyodide and PyMOL-WASM. The warm-up page has
  // its own discarded recording; the main page below is the product tour.
  const warmup = await context.newPage();
  await warmup.goto(baseUrl, { waitUntil: "domcontentloaded" });
  await waitForViewer(warmup);
  await warmup.close();

  mainPage = await context.newPage();
  mainVideo = mainPage.video();
  attachDiagnostics(mainPage, diagnostics);
  await mainPage.goto(baseUrl, { waitUntil: "domcontentloaded" });
  await installTourOverlay(mainPage);
  tourStartedAt = Date.now();

  await caption(
    mainPage,
    "ChatPyMOL：AI 与人工共同维护可回溯的分子场景",
    2_600,
    "center"
  );
  await caption(
    mainPage,
    "首次启动会加载浏览器内 PyMOL；之后即可直接交互",
    2_000,
    "bottom"
  );
  await waitForViewer(mainPage);
  await mainPage.screenshot({ path: coverImage });

  const chatScroll = mainPage.locator(".clean-chat-scroll");
  await chatScroll.evaluate((element) =>
    element.scrollTo({ top: 0, behavior: "smooth" })
  );
  await caption(
    mainPage,
    "1. 新用户会看到官方示例：真实 1AKI、自然语言修改和文件卡",
    3_200,
    "bottom"
  );
  const pdbCard = mainPage.locator(".message-structure-card", {
    hasText: "1AKI.pdb"
  }).first();
  await pointTo(mainPage, pdbCard);
  await pdbCard.click();
  await mainPage.waitForTimeout(1_200);

  const versionCards = mainPage.locator(".message-version-card");
  await versionCards.first().scrollIntoViewIfNeeded();
  await caption(
    mainPage,
    "2. 每次修改都是一个版本节点；点击即可回看当时的结构",
    2_800,
    "bottom"
  );
  await pointTo(mainPage, versionCards.first());
  await versionCards.first().click();
  await mainPage.locator(".clean-scene-statusbar.history").waitFor();
  await waitForViewer(mainPage);
  await caption(mainPage, "正在查看历史版本：原场景不会被覆盖", 2_200, "top");
  const backToLatest = mainPage.getByRole("button", { name: "返回最新" });
  await pointTo(mainPage, backToLatest);
  await backToLatest.click();
  await mainPage.locator(".clean-scene-statusbar.history").waitFor({
    state: "detached"
  });
  await waitForViewer(mainPage);

  const canvas = mainPage.getByLabel("PyMOL 原生分子编辑画布");
  await openClassicActionMenu(mainPage, canvas);
  await caption(
    mainPage,
    "3. 保留经典 PyMOL A / S / H / L / C 菜单，也支持鼠标交互",
    2_800,
    "top"
  );
  await openClassicActionMenu(mainPage, canvas);

  const command = mainPage.locator(".native-pymol-command input");
  await pointTo(mainPage, command);
  await caption(
    mainPage,
    "4. 人工可直接输入原生 PyMOL 命令；修改会自动保存",
    2_400,
    "top"
  );
  await command.pressSequentially("color cyan, all", { delay: 55 });
  await command.press("Enter");
  await mainPage.getByText(/已应用 · color cyan, all/).waitFor();

  const undo = mainPage.getByLabel("撤销", { exact: true });
  const redo = mainPage.getByLabel("重做", { exact: true });
  await undo.waitFor({ state: "visible" });
  await undo.click();
  await redo.waitFor({ state: "visible" });
  await mainPage.waitForTimeout(450);
  await redo.click();
  await caption(mainPage, "撤销与重做会同步作用于当前人工草稿", 1_800, "top");
  await mainPage.getByText("已自动保存", { exact: true }).waitFor({
    timeout: 30_000
  });
  const manualRevision = await readRevision(mainPage);

  await chatScroll.evaluate((element) =>
    element.scrollTo({ top: element.scrollHeight, behavior: "smooth" })
  );
  const composer = mainPage.locator(".clean-composer textarea");
  await pointTo(mainPage, composer);
  await caption(
    mainPage,
    "5. 下一轮 AI 会自动读取刚才的人工修改，不需要重新上传",
    2_500,
    "top"
  );
  await composer.pressSequentially("把它改成粉红色", { delay: 120 });
  await mainPage.getByLabel("发送", { exact: true }).click();
  await mainPage.getByText("已将当前结构改为粉红色。", {
    exact: true
  }).waitFor({ timeout: 30_000 });
  await waitForRevisionAfter(mainPage, manualRevision);
  await waitForViewer(mainPage);
  await caption(
    mainPage,
    "AI 已基于最新场景完成修改，并自动生成新的可回溯版本",
    2_700,
    "top"
  );

  const download = mainPage.getByLabel("下载", { exact: true });
  await pointTo(mainPage, download);
  await download.click();
  await mainPage.getByText("下载 PML", { exact: true }).waitFor();
  await caption(
    mainPage,
    "6. 可导出当前结构、PML、PSE，以及光线追踪 PNG",
    2_900,
    "top"
  );
  await download.click();

  const languageToggle = mainPage.locator(".language-clean");
  await languageToggle.click();
  await chatScroll.evaluate((element) =>
    element.scrollTo({ top: 0, behavior: "smooth" })
  );
  await mainPage.getByText(/Load a real classic protein/).waitFor();
  await caption(mainPage, "支持完整中英文界面与双语示例内容", 2_200, "bottom");
  await languageToggle.click();
  await mainPage.getByLabel("切换亮色或暗色", { exact: true }).click();
  await caption(
    mainPage,
    "亮色蓝白 · 暗色蓝黑——简洁界面，原生能力完整保留",
    2_800,
    "bottom"
  );

  await caption(
    mainPage,
    "ChatPyMOL · 自然语言、人工编辑、版本历史与专业导出",
    3_200,
    "center"
  );
  await hideTourOverlay(mainPage);
  await mainPage.waitForTimeout(500);
} catch (error) {
  recordingError = error;
  diagnostics.error = error?.stack || String(error);
} finally {
  if (mainPage && !mainPage.isClosed()) await mainPage.close();
  await context.close();
  await browser.close();
}

if (mainVideo) {
  const rawVideo = await mainVideo.path();
  await copyFile(rawVideo, finalVideo);
  diagnostics.rawVideo = rawVideo;
  diagnostics.finalVideo = finalVideo;
}
diagnostics.durationSeconds = tourStartedAt
  ? Number(((Date.now() - tourStartedAt) / 1_000).toFixed(1))
  : 0;
diagnostics.completed = !recordingError;
await writeFile(timelineFile, `${JSON.stringify(timeline, null, 2)}\n`, "utf8");
await writeFile(
  diagnosticsFile,
  `${JSON.stringify(diagnostics, null, 2)}\n`,
  "utf8"
);

if (recordingError) throw recordingError;
console.log(
  JSON.stringify(
    {
      video: finalVideo,
      cover: coverImage,
      durationSeconds: diagnostics.durationSeconds,
      captions: timeline.length
    },
    null,
    2
  )
);

function attachDiagnostics(page, report) {
  page.on("pageerror", (error) => report.pageErrors.push(error.message));
  page.on("requestfailed", (request) => {
    if (!request.url().includes("favicon")) {
      report.failedRequests.push(`${request.method()} ${request.url()}`);
    }
  });
  page.on("response", (response) => {
    if (response.status() >= 400 && !response.url().includes("favicon")) {
      report.badResponses.push(`${response.status()} ${response.url()}`);
    }
  });
}

async function waitForViewer(page) {
  await page.getByRole("button", { name: "新建对话" }).waitFor({
    timeout: 30_000
  });
  await page.locator(".native-pymol-loading").waitFor({
    state: "detached",
    timeout: 120_000
  });
  await page.locator(".native-status-ready").waitFor({ timeout: 120_000 });
}

async function installTourOverlay(page) {
  await page.evaluate(() => {
    const style = document.createElement("style");
    style.id = "chatpymol-tour-style";
    style.textContent = `
      #chatpymol-tour-caption {
        position: fixed;
        z-index: 2147483647;
        left: 50%;
        width: min(1180px, calc(100vw - 80px));
        transform: translateX(-50%);
        padding: 20px 32px;
        border: 1px solid rgba(147, 197, 253, .42);
        border-radius: 20px;
        background: rgba(8, 20, 42, .92);
        box-shadow: 0 20px 60px rgba(2, 8, 23, .32);
        color: #f8fbff;
        font: 700 40px/1.34 ui-sans-serif, system-ui, -apple-system,
          "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif;
        letter-spacing: .01em;
        text-align: center;
        opacity: 0;
        pointer-events: none;
        transition: opacity .22s ease, transform .22s ease;
      }
      #chatpymol-tour-caption[data-placement="top"] { top: 76px; }
      #chatpymol-tour-caption[data-placement="bottom"] { bottom: 42px; }
      #chatpymol-tour-caption[data-placement="center"] {
        top: 50%;
        transform: translate(-50%, -50%);
        padding-block: 34px;
        font-size: 44px;
      }
      #chatpymol-tour-caption.visible { opacity: 1; }
      #chatpymol-tour-pointer {
        position: fixed;
        z-index: 2147483646;
        width: 42px;
        height: 42px;
        margin: -21px 0 0 -21px;
        border: 4px solid #38bdf8;
        border-radius: 999px;
        background: rgba(56, 189, 248, .18);
        box-shadow: 0 0 0 8px rgba(56, 189, 248, .11);
        opacity: 0;
        pointer-events: none;
        transition: left .28s ease, top .28s ease, opacity .18s ease;
      }
      #chatpymol-tour-pointer.visible { opacity: 1; }
    `;
    document.head.append(style);
    const caption = document.createElement("div");
    caption.id = "chatpymol-tour-caption";
    caption.dataset.placement = "bottom";
    document.body.append(caption);
    const pointer = document.createElement("div");
    pointer.id = "chatpymol-tour-pointer";
    document.body.append(pointer);
  });
}

async function caption(page, text, durationMs, placement = "bottom") {
  const startedAt = Date.now();
  await page.evaluate(({ value, location }) => {
    const element = document.querySelector("#chatpymol-tour-caption");
    element.textContent = value;
    element.dataset.placement = location;
    element.classList.add("visible");
  }, { value: text, location: placement });
  timeline.push({
    text,
    placement,
    startSeconds: Number(((startedAt - tourStartedAt) / 1_000).toFixed(2)),
    durationSeconds: Number((durationMs / 1_000).toFixed(2))
  });
  await page.waitForTimeout(durationMs);
  await page.evaluate(() =>
    document.querySelector("#chatpymol-tour-caption")?.classList.remove("visible")
  );
  await page.waitForTimeout(220);
}

async function pointTo(page, locator) {
  await locator.scrollIntoViewIfNeeded();
  const box = await locator.boundingBox();
  if (!box) return;
  await page.evaluate(({ x, y }) => {
    const pointer = document.querySelector("#chatpymol-tour-pointer");
    pointer.style.left = `${x}px`;
    pointer.style.top = `${y}px`;
    pointer.classList.add("visible");
  }, { x: box.x + box.width / 2, y: box.y + box.height / 2 });
  await page.waitForTimeout(450);
}

async function hideTourOverlay(page) {
  await page.evaluate(() => {
    document.querySelector("#chatpymol-tour-caption")?.classList.remove("visible");
    document.querySelector("#chatpymol-tour-pointer")?.classList.remove("visible");
  });
}

async function openClassicActionMenu(page, canvas) {
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
  await page.evaluate(({ x, y }) => {
    const pointer = document.querySelector("#chatpymol-tour-pointer");
    pointer.style.left = `${x}px`;
    pointer.style.top = `${y}px`;
    pointer.classList.add("visible");
  }, target);
  await page.waitForTimeout(350);
  await page.mouse.click(target.x, target.y);
  await page.waitForTimeout(550);
}

async function readRevision(page) {
  return Number(
    (await page.locator(".native-pymol-version").textContent())?.replace(/\D/g, "")
  );
}

async function waitForRevisionAfter(page, previous) {
  await page.waitForFunction(
    (revision) => {
      const value = document.querySelector(".native-pymol-version")?.textContent;
      return Number(String(value || "").replace(/\D/g, "")) > revision;
    },
    previous,
    { timeout: 30_000 }
  );
}
