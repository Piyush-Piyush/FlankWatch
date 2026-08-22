import { exec } from "node:child_process";

/** Best-effort cross-platform browser open — never throws if no GUI/browser is available. */
export function openBrowser(url) {
  const cmd =
    process.platform === "win32"
      ? `start "" "${url}"`
      : process.platform === "darwin"
        ? `open "${url}"`
        : `xdg-open "${url}"`;

  exec(cmd, (err) => {
    if (err) console.error(`Could not auto-open browser (${err.message}). Open ${url} manually.`);
  });
}
