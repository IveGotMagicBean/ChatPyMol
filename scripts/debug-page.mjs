import { chromium } from "playwright";
import { chromiumLaunchOptions } from "./playwright-runtime.mjs";
const browser = await chromium.launch(chromiumLaunchOptions({
  headless: true,
  args: ["--no-sandbox"]
}));
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
await context.addInitScript(() =>
  localStorage.setItem(
    "chatpymol.device-token.v1",
    "dev_gpt_layout_review_20260726_abcdefghijklmnopqrstuvwxyz0123456789"
  )
);
const page = await context.newPage();
page.on("console", (message) => console.log("console", message.type(), message.text()));
page.on("pageerror", (error) => console.log("pageerror", error.message));
await page.goto("http://127.0.0.1:8787");
await page.waitForTimeout(3000);
console.log((await page.locator("body").innerText()).slice(0, 3000));
await browser.close();
