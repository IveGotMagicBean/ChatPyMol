import { chromium } from "playwright";
import {
  chromiumLaunchOptions,
  configurePlaywrightLibraryPath
} from "./playwright-runtime.mjs";

const BASE_URL = "http://127.0.0.1:8787";
const ONBOARDING_KEY = "chatpymol.onboarding.v1";
const tutorials = [
  {
    button: /聊天与人工协作/,
    title: "聊天与人工协作",
    src: "/tutorials/chat-collaboration.webm",
    poster: "/tutorials/chat-collaboration.jpg"
  },
  {
    button: /本地 Agent 协作/,
    title: "本地 Agent 协作",
    src: "/tutorials/local-agent-collaboration.webm",
    poster: "/tutorials/local-agent-collaboration.jpg"
  }
];

configurePlaywrightLibraryPath();
const browser = await chromium.launch(
  chromiumLaunchOptions({ headless: true, args: ["--no-sandbox"] })
);
const context = await browser.newContext({
  viewport: { width: 1440, height: 900 },
  deviceScaleFactor: 1
});
const deviceToken = `verify_onboarding_${Date.now()}_abcdefghijklmnopqrstuvwxyz`;
await context.addInitScript(({ token, onboardingKey }) => {
  localStorage.setItem("chatpymol.device-token.v1", token);
  localStorage.setItem("chatpymol.language", "zh");
  localStorage.removeItem("chatpymol.theme");
  localStorage.removeItem(onboardingKey);
  localStorage.removeItem("chatpymol.left-width");
  localStorage.removeItem("chatpymol.right-width");
}, { token: deviceToken, onboardingKey: ONBOARDING_KEY });

const page = await context.newPage();
const pageErrors = [];
page.on("pageerror", (error) => pageErrors.push(error.message));
// The tour only needs the workspace shell; do not initialize the heavy WASM runtime.
await page.route(/\/(?:pyodide|pymol-wasm)\//, (route) =>
  route.abort("blockedbyclient")
);

try {
  await page.goto(BASE_URL, { waitUntil: "domcontentloaded" });
  const welcome = page.getByRole("dialog", { name: "欢迎来到 ChatPyMOL" });
  await welcome.waitFor();

  const initialState = await page.evaluate((onboardingKey) => ({
    theme: document.documentElement.dataset.theme,
    language: document.documentElement.lang,
    onboarding: localStorage.getItem(onboardingKey)
  }), ONBOARDING_KEY);
  if (initialState.theme !== "light") {
    throw new Error(`First visit did not default to light theme: ${initialState.theme}`);
  }
  if (initialState.language !== "zh" || initialState.onboarding !== null) {
    throw new Error(`Unexpected first-visit state: ${JSON.stringify(initialState)}`);
  }
  for (const text of ["AI 修改", "人工编辑", "版本与导出"]) {
    await welcome.getByText(text, { exact: true }).waitFor();
  }

  await welcome.getByRole("button", { name: "观看演示" }).click();
  const library = page.getByRole("dialog", { name: "新手指引" });
  await library.waitFor();
  for (const tutorial of tutorials) {
    await assertRealAsset(context, tutorial.src, "video/webm");
    await assertRealAsset(context, tutorial.poster, "image/jpeg");
    await library.getByRole("button", { name: tutorial.button }).click();
    await assertActiveTutorial(library, tutorial);
  }

  await library.getByLabel("关闭").click();
  await library.waitFor({ state: "detached" });
  await page.getByLabel("新手指引").click();
  await library.waitFor();
  await assertActiveTutorial(library, tutorials[0]);

  await library.getByRole("button", { name: "重播页面引导" }).click();
  const tourCard = page.locator(".onboarding-tour-card");
  await tourCard.getByText("为每个课题新建独立对话", { exact: true }).waitFor();
  await assertSpotlight(page, '[data-tour="new-chat"]', "new chat");

  const composer = page.locator(".clean-composer textarea");
  await composer.focus();
  await page.keyboard.press("ArrowRight");
  await tourCard.getByText("为每个课题新建独立对话", { exact: true }).waitFor();

  await tourCard.getByRole("button", { name: "下一步" }).click();
  await tourCard.getByText("描述你想看到的结构", { exact: true }).waitFor();
  await assertSpotlight(page, '[data-tour="composer"]', "composer");

  await tourCard.getByRole("button", { name: "下一步" }).click();
  await tourCard.getByText("在右侧继续用 PyMOL 编辑", { exact: true }).waitFor();
  const workspace = page.locator('[data-tour="workspace-panel"]');
  if (
    (await workspace.getAttribute("aria-hidden")) === "true" ||
    (await workspace.evaluate((element) => element.getBoundingClientRect().width)) < 1
  ) {
    throw new Error("Guided tour did not open the right workspace");
  }
  await assertSpotlight(page, '[data-tour="workspace-panel"]', "workspace");

  await tourCard.getByRole("button", { name: "下一步" }).click();
  await tourCard.getByText("也可以连接本地 AI Agent", { exact: true }).waitFor();
  await assertSpotlight(page, '[data-tour="local-agent"]', "local agent");
  await tourCard.getByRole("button", { name: "完成" }).click();
  await tourCard.waitFor({ state: "detached" });
  if ((await page.evaluate((key) => localStorage.getItem(key), ONBOARDING_KEY)) !== "seen") {
    throw new Error("Completing the tour did not persist onboarding state");
  }

  await page.getByLabel("切换中英文").click();
  await page.getByLabel("Getting started").waitFor();
  await page.setViewportSize({ width: 430, height: 820 });
  await page.getByLabel("Getting started").click();
  const englishLibrary = page.getByRole("dialog", { name: "Getting started" });
  await englishLibrary.waitFor();
  await englishLibrary.getByText("Chat and manual collaboration", { exact: true }).waitFor();
  const narrowMetrics = await page.evaluate(() => {
    const dialog = document.querySelector(".onboarding-dialog")?.getBoundingClientRect();
    return {
      overflow: document.documentElement.scrollWidth > window.innerWidth,
      dialog: dialog && {
        left: dialog.left,
        right: dialog.right,
        width: dialog.width
      }
    };
  });
  if (
    narrowMetrics.overflow ||
    !narrowMetrics.dialog ||
    narrowMetrics.dialog.left < -1 ||
    narrowMetrics.dialog.right > 431
  ) {
    throw new Error(`Narrow onboarding layout is invalid: ${JSON.stringify(narrowMetrics)}`);
  }
  if (pageErrors.length) throw new Error(`Page errors: ${pageErrors.join(" | ")}`);

  console.log(JSON.stringify({
    initialState,
    tutorials: tutorials.map(({ src, poster }) => ({ src, poster })),
    tourSteps: 4,
    narrowMetrics,
    pageErrors
  }, null, 2));
} finally {
  await context.close();
  await browser.close();
}

async function assertActiveTutorial(dialog, tutorial) {
  const video = dialog.locator("video");
  await video.waitFor();
  const state = await video.evaluate((element) => ({
    poster: new URL(element.getAttribute("poster"), location.href).pathname,
    source: new URL(element.querySelector("source")?.getAttribute("src"), location.href).pathname,
    type: element.querySelector("source")?.getAttribute("type"),
    label: element.getAttribute("aria-label")
  }));
  if (
    state.poster !== tutorial.poster ||
    state.source !== tutorial.src ||
    state.type !== "video/webm" ||
    state.label !== tutorial.title
  ) {
    throw new Error(`Tutorial did not switch correctly: ${JSON.stringify(state)}`);
  }
}

async function assertRealAsset(browserContext, pathname, expectedType) {
  const response = await browserContext.request.head(`${BASE_URL}${pathname}`);
  const headers = response.headers();
  const size = Number(headers["content-length"] || 0);
  if (!response.ok() || !headers["content-type"]?.startsWith(expectedType) || size < 1024) {
    throw new Error(`Invalid tutorial asset ${pathname}: ${response.status()} ${JSON.stringify(headers)}`);
  }
}

async function assertSpotlight(targetPage, selector, label) {
  const target = targetPage.locator(selector);
  const spotlight = targetPage.locator(".onboarding-spotlight");
  await target.waitFor();
  await spotlight.waitFor();
  await targetPage.waitForFunction(() => {
    const element = document.querySelector(".onboarding-spotlight");
    return element && element.getBoundingClientRect().width > 0;
  });
  const targetBox = await target.boundingBox();
  const spotlightBox = await spotlight.boundingBox();
  const intersects =
    targetBox && spotlightBox &&
    Math.min(targetBox.x + targetBox.width, spotlightBox.x + spotlightBox.width) >
      Math.max(targetBox.x, spotlightBox.x) &&
    Math.min(targetBox.y + targetBox.height, spotlightBox.y + spotlightBox.height) >
      Math.max(targetBox.y, spotlightBox.y);
  if (!intersects) {
    throw new Error(`Missing spotlight for ${label}`);
  }
}
