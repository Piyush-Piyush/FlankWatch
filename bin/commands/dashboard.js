import spawn from "cross-spawn";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { openBrowser } from "../lib/openBrowser.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SERVER_PATH = path.join(__dirname, "..", "..", "api", "server.js");

export function dashboardCommand(options) {
  const port = options.port || process.env.PORT || 3000;
  const env = { ...process.env, PORT: String(port) };

  const child = spawn(process.execPath, [SERVER_PATH], { stdio: "inherit", env, windowsHide: true });

  const forward = (signal) => child.kill(signal);
  process.on("SIGINT", forward);
  process.on("SIGTERM", forward);

  if (options.open !== false) {
    setTimeout(() => openBrowser(`http://localhost:${port}`), 700);
  }

  child.on("exit", (code) => process.exit(code ?? 0));
}
