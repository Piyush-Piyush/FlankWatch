import { isAiEnabled, setAiEnabled } from "../../lib/aiState.js";

export function aiCommand(state) {
  if (state === undefined) {
    console.log(`AI is currently ${isAiEnabled() ? "on" : "off"}.`);
    return;
  }

  if (state !== "on" && state !== "off") {
    console.error(`"${state}" isn't valid — use "flank ai on" or "flank ai off".`);
    process.exitCode = 1;
    return;
  }

  setAiEnabled(state === "on");
  console.log(`AI is now ${state}. Takes effect immediately — a running dashboard's next poll (within a few seconds) will reflect it, no restart needed.`);

  if (state === "on") {
    const hasKey = Boolean(process.env.GEMINI_API_KEY);
    if (!hasKey) console.log('No GEMINI_API_KEY on file yet — AI stays off in practice until you set one: "flank set-gemini-key".');
  }
}
