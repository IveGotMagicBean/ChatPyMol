import { firefox } from "playwright";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const browser = await firefox.launch({
  headless: true,
  args: ["--no-sandbox"]
});
const context = await browser.newContext({
  viewport: { width: 1440, height: 900 }
});
await context.addInitScript(() => {
  localStorage.setItem(
    "chatpymol.device-token.v1",
    "dev_clean_ui_20260726_abcdefghijklmnopqrstuvwxyz0123456789"
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

const initial = {
  left: await page.locator(".clean-sidebar").count(),
  right: await page.locator(".clean-right-panel").count()
};
if (initial.left !== 1 || initial.right !== 0) {
  throw new Error(`Unexpected initial panels: ${JSON.stringify(initial)}`);
}

await page.getByLabel("收起左侧栏").click();
if ((await page.locator(".clean-sidebar").count()) !== 0) {
  throw new Error("Left sidebar did not close");
}
await page.getByLabel("展开左侧栏").click();

await page.getByLabel("打开工作区").click();
await page.locator(".clean-right-panel").waitFor();
await page.getByLabel("关闭工作区").last().click();

await page.locator('input[type="file"]').setInputFiles(
  path.join(root, "scripts/fixtures/mini.pdb")
);
await page.getByRole("button", { name: /mini\.pdb/ }).waitFor();
await page.locator(".clean-right-panel").waitFor();
await page.locator(".native-export-trigger").click();
await page.getByText("原始结构文件", { exact: true }).waitFor();
await page.locator(".native-export-trigger").click();

const conversationCount = await page.locator(".clean-conversation-row").count();
await page.getByRole("button", { name: "新建对话" }).click();
await page.waitForFunction(
  (count) => document.querySelectorAll(".clean-conversation-row").length > count,
  conversationCount
);

const activeRow = page.locator(".clean-conversation-row.active");
await activeRow.locator(".conversation-menu-button").click();
await page.getByRole("button", { name: "重命名" }).click();
const titleInput = activeRow.locator("input");
await titleInput.fill("结构讨论");
await titleInput.press("Enter");
await page.getByText("结构讨论", { exact: true }).waitFor();

await activeRow.locator(".conversation-menu-button").click();
await page.getByRole("button", { name: "置顶" }).click();
if ((await activeRow.locator(".conversation-title-button svg").count()) !== 1) {
  throw new Error("Pin state was not rendered");
}

await page.getByLabel("切换中英文").click();
await page.getByRole("button", { name: "New chat" }).waitFor();
await page.getByLabel("Switch light or dark theme").click();

const forbidden = [
  "Skills 自动匹配",
  "配体口袋",
  "当前对话版本",
  "文件与下载",
  "qwen3.7-max",
  "已保存"
];
for (const text of forbidden) {
  if ((await page.getByText(text, { exact: false }).count()) > 0) {
    throw new Error(`Unexpected UI text: ${text}`);
  }
}

const metrics = await page.evaluate(() => ({
  overflow: document.body.scrollWidth > document.body.clientWidth,
  theme: document.documentElement.dataset.theme,
  language: document.documentElement.lang,
  github: document.querySelector('a[aria-label="GitHub"]')?.href
}));
if (metrics.overflow) throw new Error("Layout has horizontal overflow");
if (pageErrors.length) throw new Error(pageErrors.join(" | "));

await page.screenshot({
  path: "artifacts/clean-layout-dark-en.png",
  fullPage: true
});
console.log(JSON.stringify({ initial, metrics, pageErrors }, null, 2));

await context.close();
await browser.close();
