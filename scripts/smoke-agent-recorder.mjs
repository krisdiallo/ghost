// Scripted transport regression test. This is not the independent-agent run.
import assert from "node:assert/strict";
import { spawn, execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve, join } from "node:path";

const dir =
  process.env.GHOST_AGENT_TEST_DIR ??
  (await mkdtemp(join(tmpdir(), "ghost-agent-recorder-")));
const env = {
  ...process.env,
  GHOST_AGENT_DIR: dir,
  GHOST_AGENT_ACTOR: "Scripted recorder regression test; not an LLM mission",
};
const child = spawn(process.execPath, [resolve("scripts/agent-session.mjs")], {
  env,
  stdio: ["ignore", "pipe", "pipe"],
});
let stdout = "",
  stderr = "";
child.stdout.on("data", (chunk) => {
  stdout += chunk;
});
child.stderr.on("data", (chunk) => {
  stderr += chunk;
});
const call = async (command) =>
  JSON.parse(
    (
      await promisify(execFile)(
        process.execPath,
        [resolve("scripts/agent-command.mjs"), JSON.stringify(command)],
        { env, timeout: 90000, maxBuffer: 4 * 1024 * 1024 },
      )
    ).stdout,
  );
let finished = false;
try {
  const deadline = Date.now() + 30000;
  while (!stdout.includes('"status":"ready"')) {
    assert.ok(
      child.exitCode === null,
      `recorder failed: ${stderr.slice(-500)}`,
    );
    assert.ok(Date.now() < deadline, "recorder starts");
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  assert.equal((await call({ tools: true })).tools.length, 5);
  await call({
    objective:
      "Test recorder transport, interleaved cameras, privacy and cleanup.",
  });
  await call({
    tool: "possess",
    arguments: { resourceId: "camera-01", ttlSeconds: 120 },
  });
  const first = await call({
    tool: "observe",
    arguments: { leaseRef: "camera-01", image: true },
  });
  assert.equal(first.isError, false);
  assert.ok(first.image?.absolutePath);
  assert.ok(!first.presentationError);
  await call({
    tool: "possess",
    arguments: { resourceId: "rover-01", ttlSeconds: 120 },
  });
  // Reproduce the live run's presentation failure: observe an existing lease
  // while the spectator UI is focused on another possessed body.
  const second = await call({
    tool: "observe",
    arguments: { leaseRef: "camera-01", image: true },
  });
  assert.equal(second.result.body.id, "camera-01");
  assert.ok(second.image?.absolutePath);
  assert.ok(!second.presentationError, "spectator follows the observed body");
  const image = await readFile(second.image.absolutePath);
  assert.equal(image.readUInt16BE(0), 0xffd8);
  const bad = await call({
    tool: "observe",
    arguments: { leaseRef: "unknown-body" },
  });
  assert.match(bad.error, /Possess/);
  const result = await call({
    finish: "Transport checks complete; no mission outcome claimed.",
  });
  finished = true;
  assert.equal(result.status, "finished");
  const trace = await readFile(join(dir, "trace.json"), "utf8");
  assert.ok(
    !/"leaseId"\s*:/.test(trace),
    "public trace has no capability fields",
  );
  assert.ok(!trace.includes("frameData"));
  assert.ok(!trace.includes("data:image"));
  const snapshot = JSON.parse(
    await readFile(join(dir, "final-snapshot.json"), "utf8"),
  );
  assert.ok(snapshot.bodies.every((body) => !body.lease));
  assert.deepEqual(result.browserErrors, []);
  console.log(
    "Recorder passed: actual MCP images, interleaved body observations, private capability substitution, public trace and cleanup.",
  );
} finally {
  if (!finished && child.exitCode === null) {
    try {
      await call({ finish: "Test cleanup after failure." });
    } catch {
      child.kill("SIGTERM");
    }
  }
}
