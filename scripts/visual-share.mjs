import { chromium } from "playwright";
import { chromiumLaunchOptions } from "./playwright-runtime.mjs";

const shareUrl = process.env.CHATPYMOL_SHARE_URL;
if (!shareUrl) throw new Error("CHATPYMOL_SHARE_URL is required");

const browser = await chromium.launch(
  chromiumLaunchOptions({
    headless: true,
    args: ["--no-sandbox", "--enable-unsafe-webgpu", "--use-angle=swiftshader"]
  })
);
const context = await browser.newContext({
  viewport: { width: 1440, height: 900 },
  deviceScaleFactor: 1
});
await context.addInitScript(() => {
  localStorage.setItem("chatpymol.theme", "light");
  localStorage.setItem("chatpymol.language", "zh");
  localStorage.removeItem("chatpymol.device-token.v1");
});

const page = await context.newPage();
const errors = [];
const privateHeaders = [];
page.on("pageerror", (error) => errors.push(`pageerror: ${error.message}`));
page.on("console", (message) => {
  if (message.type() === "error") errors.push(`console: ${message.text()}`);
});
page.on("request", (request) => {
  if (request.url().includes("/api/shares/")) {
    const token = request.headers()["x-device-token"];
    if (token) privateHeaders.push(token);
  }
});

await page.goto(shareUrl, { waitUntil: "networkidle" });
await page.locator(".shared-title h1").waitFor();
await page.locator(".native-status-ready").waitFor({ timeout: 120_000 });
await page.screenshot({ path: "/tmp/chatpymol-share-light.png", fullPage: true });

const cards = page.locator(".message-version-card");
const cardCount = await cards.count();
if (cardCount > 1) {
  await cards.first().click();
  await page.getByText("v2", { exact: true }).first().waitFor();
}

await page.getByLabel("切换亮色或暗色").click();
await page.screenshot({ path: "/tmp/chatpymol-share-dark.png", fullPage: true });

const result = {
  title: await page.locator(".shared-title h1").textContent(),
  messages: await page.locator(".shared-messages .clean-message").count(),
  versions: cardCount,
  viewerReady: await page.locator(".native-status-ready").count(),
  commandInputs: await page.locator(".native-pymol-command").count(),
  deviceTokenHeaders: privateHeaders.length,
  errors
};

console.log(JSON.stringify(result, null, 2));
await context.close();
await browser.close();

if (errors.length || privateHeaders.length || result.commandInputs) process.exitCode = 1;
