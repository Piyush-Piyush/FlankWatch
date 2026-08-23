import { dismissPending } from "../../api/services/collectorService.js";

export function dismissBuildCommand(id) {
  const pendingId = Number(id);
  if (!Number.isInteger(pendingId)) {
    console.error(`"${id}" isn't a valid build id — use the numeric #id from \`flank list\` (e.g. flank dismiss-build 13).`);
    process.exitCode = 1;
    return;
  }

  try {
    const row = dismissPending(pendingId);
    console.log(`Dismissed pending build #${pendingId} (${row.name}, was "${row.status}").`);
  } catch (err) {
    console.error(`Error: ${err.message}`);
    process.exitCode = 1;
  }
}
