import { firefox } from "playwright";

const browser = await firefox.launch({
  headless: true,
  args: [
    "--no-sandbox",
  ]
});

const context = await browser.newContext({
  viewport: { width: 1440, height: 900 },
  deviceScaleFactor: 1,
  recordVideo: process.env.RECORD_VIDEO
    ? { dir: "artifacts/video", size: { width: 1440, height: 900 } }
    : undefined
});

await context.addInitScript(() => {
  localStorage.setItem(
    "chatpymol.device-token.v1",
    "dev_visual_review_20260725_abcdefghijklmnopqrstuvwxyz0123456789"
  );
});

const page = await context.newPage();
const errors = [];
page.on("pageerror", (error) => errors.push(`pageerror: ${error.message}`));
page.on("console", (message) => {
  if (message.type() === "error") errors.push(`console: ${message.text()}`);
});

await page.goto("http://127.0.0.1:8787", { waitUntil: "networkidle" });
await page.getByText("场景对话", { exact: true }).waitFor();
await page.screenshot({ path: "artifacts/workspace-empty.png", fullPage: true });

await page.getByRole("button", { name: "示例玩法" }).click();
await page.getByText("从一个真实案例开始", { exact: true }).waitFor();
await page.screenshot({ path: "artifacts/use-cases.png", fullPage: true });

await page
  .getByRole("article")
  .filter({ hasText: "第一次看懂蛋白结构" })
  .getByRole("button", { name: "运行这个案例" })
  .click();
await page.getByText("1CRN", { exact: true }).first().waitFor({ timeout: 40_000 });
await page.waitForTimeout(1_500);
await page.screenshot({ path: "artifacts/workspace-1crn.png", fullPage: true });

await page.getByRole("button", { name: "版本" }).click();
await page.getByText("场景时间线", { exact: true }).waitFor();
await page.screenshot({ path: "artifacts/history.png", fullPage: true });

const result = {
  title: await page.title(),
  structures: await page.locator(".asset-row").count(),
  versions: await page.locator(".history-item").count(),
  errors
};

console.log(JSON.stringify(result, null, 2));
await context.close();
await browser.close();
