// Send one command to a running recorder, including from a fresh Codex agent.
// No warehouse policy or world-state access exists in this client.
import { readFile, writeFile, rename, unlink, access } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { resolve, join } from "node:path";
const output = resolve(process.env.GHOST_AGENT_DIR ?? "work/agent-session");
const dir = join(output, "commands");
await access(dir);
let input = process.argv[2];
if (!input) {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  input = Buffer.concat(chunks).toString();
}
if (Buffer.byteLength(input) > 16384)
  throw new Error("Recorder commands are limited to 16 KB.");
const command = JSON.parse(input);
const id = randomUUID();
const request = join(dir, `${id}.request.json`);
const response = join(dir, `${id}.response.json`);
await writeFile(request + ".tmp", JSON.stringify(command), { mode: 0o600 });
await rename(request + ".tmp", request);
const deadline = Date.now() + 120000;
while (true) {
  try {
    const result = JSON.parse(await readFile(response, "utf8"));
    await unlink(response);
    process.stdout.write(JSON.stringify(result) + "\n");
    break;
  } catch (error) {
    // Also tolerate an older running recorder whose reply write is not atomic.
    if (error.code !== "ENOENT" && !(error instanceof SyntaxError)) throw error;
    if (Date.now() >= deadline)
      throw new Error(
        "Recorder did not answer within 120 seconds. Do not resubmit a motion until its status is checked.",
      );
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}
