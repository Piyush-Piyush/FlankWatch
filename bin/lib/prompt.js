import { createInterface } from "node:readline/promises";

export async function askText(question) {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    return (await rl.question(question)).trim();
  } finally {
    rl.close();
  }
}

export async function askYesNo(question, defaultYes = true) {
  const suffix = defaultYes ? "[Y/n] " : "[y/N] ";
  const answer = (await askText(`${question} ${suffix}`)).toLowerCase();
  if (!answer) return defaultYes;
  return answer === "y" || answer === "yes";
}
