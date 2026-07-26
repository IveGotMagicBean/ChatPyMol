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
    "dev_gpt_layout_review_20260726_abcdefghijklmnopqrstuvwxyz0123456789"
  );
  localStorage.setItem("chatpymol.theme", "light");
});
const page = await context.newPage();
const errors = [];
page.on("pageerror", (error) => errors.push(error.message));

await page.goto("http://127.0.0.1:8787", { waitUntil: "networkidle" });
await page.getByRole("button", { name: "新建对话" }).waitFor();
await page.screenshot({ path: "artifacts/gpt-layout-light.png", fullPage: true });

await page.getByRole("button", { name: /Skills 自动匹配/ }).click();
await page.getByText("已启用的分子可视化 Skills").waitFor();
await page.screenshot({ path: "artifacts/gpt-skills.png", fullPage: true });
await page.getByRole("button", { name: /Skills 自动匹配/ }).click();

const before = await page.locator(".conversation-row").count();
await page.getByRole("button", { name: "新建对话" }).click();
await page.waitForFunction(
  (count) => document.querySelectorAll(".conversation-row").length > count,
  before
);
const after = await page.locator(".conversation-row").count();
await page.screenshot({ path: "artifacts/gpt-new-chat.png", fullPage: true });

await page.getByLabel("切换亮色或暗色").click();
await page.screenshot({ path: "artifacts/gpt-layout-dark.png", fullPage: true });

const metrics = await page.evaluate(() => ({
  sidebarWidth: Math.round(
    document.querySelector(".conversation-sidebar").getBoundingClientRect().width
  ),
  chatWidth: Math.round(
    document.querySelector(".conversation-column").getBoundingClientRect().width
  ),
  workspaceWidth: Math.round(
    document.querySelector(".right-column").getBoundingClientRect().width
  ),
  bodyOverflow: document.body.scrollWidth > document.body.clientWidth
}));

console.log(
  JSON.stringify(
    {
      before,
      after,
      metrics,
      provider: await page.locator(".provider-state").innerText(),
      errors
    },
    null,
    2
  )
);
await context.close();
await browser.close();
