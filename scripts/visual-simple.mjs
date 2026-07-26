import { chromium } from "playwright";
import { chromiumLaunchOptions } from "./playwright-runtime.mjs";

const browser = await chromium.launch(chromiumLaunchOptions({
  headless: true,
  args: ["--no-sandbox", "--enable-unsafe-webgpu", "--use-angle=swiftshader"]
}));
const context = await browser.newContext({
  viewport: { width: 1440, height: 900 },
  deviceScaleFactor: 1
});
await context.addInitScript(() => {
  localStorage.setItem(
    "chatpymol.device-token.v1",
    "dev_visual_review_20260725_abcdefghijklmnopqrstuvwxyz0123456789"
  );
  localStorage.setItem("chatpymol.theme", "light");
});
const page = await context.newPage();
const errors = [];
page.on("pageerror", (error) => errors.push(error.message));

await page.goto("http://127.0.0.1:8787", { waitUntil: "networkidle" });
await page.getByText("历史记录", { exact: true }).waitFor();
await page.screenshot({ path: "artifacts/simple-light.png", fullPage: true });

const columns = await page.locator(".three-columns > *").evaluateAll((nodes) =>
  nodes.map((node) => ({
    className: node.className,
    width: Math.round(node.getBoundingClientRect().width),
    height: Math.round(node.getBoundingClientRect().height)
  }))
);

await page.getByLabel("切换亮色或暗色").click();
await page.screenshot({ path: "artifacts/simple-dark.png", fullPage: true });

await page.getByRole("button", { name: "PML 文件" }).click();
await page.getByLabel("PML 编辑器").waitFor();
await page.screenshot({ path: "artifacts/simple-pml.png", fullPage: true });

await page.getByRole("button", { name: "文件与下载" }).click();
await page.getByText("获取蛋白", { exact: true }).waitFor();
await page.screenshot({ path: "artifacts/simple-files.png", fullPage: true });

const historyNodes = page.locator(".timeline-node");
if ((await historyNodes.count()) > 1) {
  await historyNodes.nth(1).click();
  await page.getByText(/正在查看版本/).waitFor();
  await page.screenshot({ path: "artifacts/simple-history-preview.png", fullPage: true });
}

console.log(
  JSON.stringify(
    {
      title: await page.title(),
      columns,
      historyNodes: await historyNodes.count(),
      changeCards: await page.locator(".change-card").count(),
      errors
    },
    null,
    2
  )
);
await context.close();
await browser.close();
