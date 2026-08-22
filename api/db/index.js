import Database from "better-sqlite3";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_PATH = process.env.FLANKWATCH_DB_PATH || path.join(__dirname, "flankwatch.db");

export const db = new Database(DB_PATH);
db.pragma("journal_mode = WAL");

const schema = readFileSync(path.join(__dirname, "schema.sql"), "utf-8");
db.exec(schema);
