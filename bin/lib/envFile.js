import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const ROOT_DIR = path.join(__dirname, "..", "..");
export const ENV_PATH = path.join(ROOT_DIR, ".env");
export const ENV_EXAMPLE_PATH = path.join(ROOT_DIR, ".env.example");

/**
 * Sets KEY=value in .env without disturbing any other line. Creates .env
 * from .env.example (keeping its comments) if it doesn't exist yet, or a
 * minimal file if even .env.example is missing.
 */
export function upsertEnvVar(key, value) {
  let contents;
  if (existsSync(ENV_PATH)) {
    contents = readFileSync(ENV_PATH, "utf-8");
  } else if (existsSync(ENV_EXAMPLE_PATH)) {
    contents = readFileSync(ENV_EXAMPLE_PATH, "utf-8");
  } else {
    contents = "";
  }

  const lines = contents.split("\n");
  const pattern = new RegExp(`^${key}=`);
  const idx = lines.findIndex((line) => pattern.test(line));
  const newLine = `${key}=${value}`;

  if (idx >= 0) {
    lines[idx] = newLine;
  } else {
    if (lines.length && lines[lines.length - 1] !== "") lines.push("");
    lines.push(newLine);
  }

  writeFileSync(ENV_PATH, lines.join("\n"));
}
