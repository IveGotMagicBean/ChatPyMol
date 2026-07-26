export function chromiumLaunchOptions(options = {}) {
  const executablePath = String(
    process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ||
      process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ||
      ""
  ).trim();
  return executablePath ? { ...options, executablePath } : options;
}

export function configurePlaywrightLibraryPath() {
  const extraLibraryPath = String(
    process.env.PLAYWRIGHT_EXTRA_LIBRARY_PATH || ""
  ).trim();
  if (!extraLibraryPath) return;
  process.env.LD_LIBRARY_PATH = [
    extraLibraryPath,
    process.env.LD_LIBRARY_PATH || ""
  ].filter(Boolean).join(":");
}
