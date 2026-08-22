import "dotenv/config";
import { triggerHeal, approveHeal } from "../api/services/healService.js";

const diagnosis = process.argv[2] || "Also capture a currency_symbol field for each pricing tier, separate from the price value.";

const healResult = await triggerHeal("postman", diagnosis);
console.log("--- heal ---");
console.log(JSON.stringify(healResult, null, 2));

const approveResult = await approveHeal("postman");
console.log("--- approve ---");
console.log(JSON.stringify(approveResult, null, 2));
