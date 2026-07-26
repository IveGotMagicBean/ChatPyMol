import { chromium } from "playwright";
import { chromiumLaunchOptions } from "./playwright-runtime.mjs";

const variants = [
  {
    name: "angle-swiftshader",
    args: ["--enable-unsafe-webgpu", "--use-angle=swiftshader", "--disable-gpu-sandbox"]
  },
  {
    name: "vulkan-swiftshader",
    args: [
      "--enable-unsafe-webgpu",
      "--enable-features=Vulkan,UseSkiaRenderer",
      "--use-angle=vulkan",
      "--use-vulkan=swiftshader",
      "--disable-gpu-sandbox"
    ]
  },
  {
    name: "dawn-unsafe",
    args: [
      "--enable-unsafe-webgpu",
      "--enable-dawn-features=allow_unsafe_apis",
      "--use-angle=swiftshader",
      "--disable-gpu-sandbox"
    ]
  }
];

for (const variant of variants) {
  const browser = await chromium.launch(chromiumLaunchOptions({
    headless: true,
    args: ["--no-sandbox", ...variant.args]
  }));
  const page = await browser.newPage();
  await page.goto("http://127.0.0.1:8787");
  const result = await page.evaluate(async () => {
    if (!navigator.gpu) return { exposed: false, adapter: false };
    const adapter = await navigator.gpu.requestAdapter();
    return { exposed: true, adapter: Boolean(adapter) };
  });
  console.log(variant.name, result);
  await browser.close();
}
