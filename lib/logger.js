const DEBUG = process.env.DEBUG === "true";

function timestamp() {
  return new Date().toISOString().split("T")[1].replace("Z", "");
}

function format(scope, message) {
  return `[${timestamp()}] [${scope}] ${message}`;
}

/** Step-by-step tracing — only printed when DEBUG=true (npm run debug). */
export function debugLog(scope, message, data) {
  if (!DEBUG) return;
  if (data !== undefined) console.log(format(scope, message), data);
  else console.log(format(scope, message));
}

/** Always-on lifecycle log (job started/finished, server up) — printed regardless of DEBUG. */
export function log(scope, message, data) {
  if (data !== undefined) console.log(format(scope, message), data);
  else console.log(format(scope, message));
}

export function logError(scope, message, err) {
  console.error(format(scope, `ERROR: ${message}`), err?.message ?? err);
}

export const isDebug = DEBUG;
