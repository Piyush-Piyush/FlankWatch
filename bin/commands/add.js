import { db } from "../../api/db/index.js";
import { startCollectorCreation, runCreateJob } from "../../api/services/collectorService.js";

export async function addCommand(name, url, options) {
  const { pendingId, name: slug } = startCollectorCreation({
    name,
    url,
    category: options.category,
    description: options.description,
  });

  console.log(`Building "${slug}" — Bright Data's AI is generating the scraper (a few minutes)...`);
  await runCreateJob(pendingId);

  const row = db.prepare("SELECT * FROM pending_collectors WHERE id = ?").get(pendingId);
  if (row.status === "done") {
    console.log(`"${slug}" is live — collector ${row.collector_id}, category "${options.category || "Uncategorized"}".`);
  } else {
    console.error(`Build failed: ${row.error}`);
    process.exitCode = 1;
  }
}
