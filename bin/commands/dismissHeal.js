import { dismissHeal } from "../../api/services/healService.js";

export function dismissHealCommand(name) {
  dismissHeal(name);
  console.log(`Dismissed the stuck heal for "${name}".`);
}
