import { spawn } from "node:child_process";
const children = [];
const port = process.env.GHOST_PORT ?? "3001";
let existing = false;
try {
  const response = await fetch(`http://127.0.0.1:${port}/api/health`, {
    signal: AbortSignal.timeout(1000),
  });
  existing = response.ok && (await response.json()).service === "ghost";
} catch {
  /* Start the authority below when no service is listening. */
}
if (existing)
  console.error(`GHOST · using the existing warehouse on port ${port}`);
else
  children.push(
    spawn(
      process.execPath,
      ["node_modules/tsx/dist/cli.mjs", "apps/server/src/index.ts", "--serve"],
      { stdio: "inherit" },
    ),
  );
children.push(
  spawn(process.execPath, ["../../node_modules/vite/bin/vite.js"], {
    cwd: "apps/web",
    stdio: "inherit",
  }),
);
let stopping = false;
function stop() {
  if (stopping) return;
  stopping = true;
  for (const child of children) child.kill("SIGTERM");
}
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, stop);
for (const child of children) {
  child.on("error", (error) => {
    console.error(error.message);
    stop();
    process.exitCode = 1;
  });
  child.on("exit", (code) => {
    if (!stopping) {
      stop();
      process.exitCode = code ?? 1;
    }
  });
}
