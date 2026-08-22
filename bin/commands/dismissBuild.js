import { dismissPending } from "../../api/services/collectorService.js";

export function dismissBuildCommand(id) {
  dismissPending(Number(id));
  console.log(`Dismissed pending build #${id}.`);
}
