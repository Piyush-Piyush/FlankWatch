import { approveHeal } from "../../api/services/healService.js";

export async function approveCommand(name, options) {
  const result = await approveHeal(name, { reject: Boolean(options.reject) });
  console.log(JSON.stringify(result, null, 2));
  if (result.status === "needs_review") process.exitCode = 1;
}
