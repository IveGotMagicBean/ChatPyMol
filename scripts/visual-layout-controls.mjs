import { chromium } from "playwright";
import { chromiumLaunchOptions } from "./playwright-runtime.mjs";

const browser = await chromium.launch(chromiumLaunchOptions({
  headless: true,
  args: ["--no-sandbox"]
}));
const context = await browser.newContext({
  viewport: { width: 1440, height: 900 },
  deviceScaleFactor: 1
});
await context.addInitScript(() => {
  localStorage.setItem(
    "chatpymol.device-token.v1",
    "dev_layout_controls_20260726_abcdefghijklmnopqrstuvwxyz0123456789"
  );
  localStorage.setItem("chatpymol.theme", "light");
  localStorage.setItem("chatpymol.language", "zh");
  localStorage.removeItem("chatpymol.left-width");
  localStorage.removeItem("chatpymol.right-width");
});

const page = await context.newPage();
const pageErrors = [];
page.on("pageerror", (error) => pageErrors.push(error.message));
await page.goto("http://127.0.0.1:8787", { waitUntil: "networkidle" });
await page.getByRole("button", { name: "新建对话" }).waitFor();

const widthOf = (selector) =>
  page.locator(selector).evaluate((element) =>
    Math.round(element.getBoundingClientRect().width)
  );

const leftBefore = await widthOf(".conversation-sidebar");
const leftHandle = await page.getByRole("separator", {
  name: "调整左侧栏宽度"
}).boundingBox();
await page.mouse.move(leftHandle.x + leftHandle.width / 2, leftHandle.y + 100);
await page.mouse.down();
await page.mouse.move(leftHandle.x + 62, leftHandle.y + 100, { steps: 6 });
await page.mouse.up();
const leftAfter = await widthOf(".conversation-sidebar");

const rightBefore = await widthOf(".right-column");
const rightHandle = await page.getByRole("separator", {
  name: "调整右侧栏宽度"
}).boundingBox();
await page.mouse.move(rightHandle.x + rightHandle.width / 2, rightHandle.y + 100);
await page.mouse.down();
await page.mouse.move(rightHandle.x - 52, rightHandle.y + 100, { steps: 6 });
await page.mouse.up();
const rightAfter = await widthOf(".right-column");

await page.getByLabel("收起左侧栏").click();
const leftCollapsed = (await page.locator(".conversation-sidebar").count()) === 0;
await page.getByLabel("展开左侧栏").click();
await page.getByLabel("收起右侧栏").click();
const rightCollapsed = (await page.locator(".right-column").count()) === 0;
await page.getByLabel("展开右侧栏").click();

await page.getByLabel("切换中英文").click();
await page.getByRole("button", { name: "New chat" }).waitFor();
await page.getByRole("button", { name: /Files & export/ }).click();
await page.getByText("Get structures").waitFor();
await page.screenshot({
  path: "artifacts/layout-controls-en-light.png",
  fullPage: true
});

await page.getByLabel("Switch light or dark theme").click();
await page.screenshot({
  path: "artifacts/layout-controls-en-dark.png",
  fullPage: true
});

const metrics = await page.evaluate(() => ({
  bodyOverflow: document.body.scrollWidth > document.body.clientWidth,
  theme: document.documentElement.dataset.theme,
  language: document.documentElement.lang,
  savedLeftWidth: Number(localStorage.getItem("chatpymol.left-width")),
  savedRightWidth: Number(localStorage.getItem("chatpymol.right-width"))
}));

if (leftAfter < leftBefore + 45) throw new Error("Left sidebar did not resize");
if (rightAfter < rightBefore + 35) throw new Error("Right workspace did not resize");
if (!leftCollapsed || !rightCollapsed) throw new Error("Sidebar collapse failed");
if (metrics.bodyOverflow) throw new Error("Desktop layout has horizontal overflow");
if (pageErrors.length) throw new Error(`Page errors: ${pageErrors.join(" | ")}`);

console.log(JSON.stringify({
  leftBefore,
  leftAfter,
  rightBefore,
  rightAfter,
  leftCollapsed,
  rightCollapsed,
  ...metrics
}, null, 2));

await context.close();
await browser.close();
