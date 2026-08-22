import { deleteCollector } from "../../api/services/collectorService.js";
import { askYesNo } from "../lib/prompt.js";

export async function deleteCommand(name, options) {
  if (!options.yes) {
    const confirmed = await askYesNo(`Stop tracking "${name}" and wipe its run/heal history? This can't be undone.`, false);
    if (!confirmed) {
      console.log("Cancelled.");
      return;
    }
  }

  const removed = deleteCollector(name);
  console.log(`Removed "${name}" (was in category "${removed.category || "Uncategorized"}").`);
}
