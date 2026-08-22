import "dotenv/config";
import { runCollectorForCompetitor } from "../api/services/pipeline.js";

const aiEnabled = process.env.AI_ENABLED === "true";
const aiApiKey = process.env.GEMINI_API_KEY || null;

const result = await runCollectorForCompetitor("postman", { aiEnabled, aiApiKey });
console.log(JSON.stringify(result, null, 2));
