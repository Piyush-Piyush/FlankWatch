#!/usr/bin/env node
import "dotenv/config";
import { Command } from "commander";
import pkg from "../package.json" with { type: "json" };

import { setupCommand } from "./commands/setup.js";
import { setGeminiKeyCommand } from "./commands/setGeminiKey.js";
import { listCommand } from "./commands/list.js";
import { addCommand } from "./commands/add.js";
import { deleteCommand } from "./commands/delete.js";
import { runCommand } from "./commands/run.js";
import { healCommand } from "./commands/heal.js";
import { approveCommand } from "./commands/approve.js";
import { dismissHealCommand } from "./commands/dismissHeal.js";
import { dismissBuildCommand } from "./commands/dismissBuild.js";
import { scheduleCommand } from "./commands/schedule.js";
import { dashboardCommand } from "./commands/dashboard.js";

const program = new Command();

program.name("flankwatch").description("Self-healing competitor pricing monitor — terminal interface.").version(pkg.version);

program
  .command("setup")
  .alias("login")
  .description("Log in to Bright Data and optionally set a Gemini API key")
  .action(setupCommand);

program
  .command("set-gemini-key [key]")
  .description("Set (or overwrite) the Gemini API key in .env, without redoing bdata login")
  .action(setGeminiKeyCommand);

program
  .command("list")
  .description("Show tracked competitors, pending builds, and schedules")
  .option("--json", "output raw JSON instead of a table")
  .action(listCommand);

program
  .command("add <name> <url>")
  .description("Build a new scraper on demand (Bright Data AI generates it)")
  .option("-c, --category <category>", "group/segment (default: Uncategorized)")
  .option("-d, --description <description>", "what to extract (default: full pricing tier extraction)")
  .action(addCommand);

program
  .command("delete <name>")
  .description("Stop tracking a competitor and wipe its history")
  .option("-y, --yes", "skip the confirmation prompt")
  .action(deleteCommand);

program
  .command("run <name>")
  .description("Trigger a run now; auto-heals if it comes back degraded")
  .option("-u, --url <url>", "override the collector's configured URL")
  .option("--no-heal", "skip auto-heal even if the run comes back degraded")
  .action(runCommand);

program
  .command("heal <name>")
  .description("Manually trigger a heal (auto-generates a diagnosis if omitted)")
  .option("--diagnosis <text>", "explicit diagnosis text instead of auto-generating one")
  .action(healCommand);

program
  .command("approve <name>")
  .description("Approve (or reject) the most recent awaiting-approval heal")
  .option("--reject", "reject instead of approve")
  .action(approveCommand);

program
  .command("dismiss-heal <name>")
  .description("Clear a stuck needs_review heal")
  .action(dismissHealCommand);

program
  .command("dismiss-build <id>")
  .description("Clear a failed pending collector build")
  .action(dismissBuildCommand);

program
  .command("schedule <category> [cron]")
  .description('Set (or --clear) a group\'s cron schedule, e.g. flankwatch schedule "API tools" "0 9 * * *"')
  .option("--clear", "remove the schedule instead of setting one")
  .action(scheduleCommand);

program
  .command("dashboard")
  .description("Start the dashboard server and open it in your browser")
  .option("--no-open", "don't auto-open the browser")
  .option("--port <port>", "port to listen on", (v) => Number(v))
  .action(dashboardCommand);

program.parseAsync(process.argv).catch((err) => {
  console.error(`Error: ${err.message ?? err}`);
  process.exit(1);
});
