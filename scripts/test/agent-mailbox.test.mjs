import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readdir, writeFile, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { spawn } from "node:child_process";

test(
  "mailbox client waits for a complete reply without resubmitting the command",
  { timeout: 5000 },
  async () => {
    const dir = await mkdtemp(join(tmpdir(), "ghost-mailbox-test-"));
    await mkdir(join(dir, "commands"));
    const child = spawn(
      process.execPath,
      [resolve("scripts/agent-command.mjs"), '{"tools":true}'],
      {
        env: { ...process.env, GHOST_AGENT_DIR: dir },
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    let output = "",
      errors = "";
    child.stdout.on("data", (data) => (output += data));
    child.stderr.on("data", (data) => (errors += data));
    const done = new Promise((resolve) =>
      child.on("exit", (code) => resolve(code)),
    );
    try {
      let request;
      const deadline = Date.now() + 3000;
      while (!request) {
        request = (await readdir(join(dir, "commands"))).find((name) =>
          name.endsWith(".request.json"),
        );
        assert.ok(Date.now() < deadline, "client submits one request");
        if (!request) await new Promise((resolve) => setTimeout(resolve, 20));
      }
      const reply = join(
        dir,
        "commands",
        request.replace(".request.json", ".response.json"),
      );
      await writeFile(reply, "");
      await new Promise((resolve) => setTimeout(resolve, 180));
      assert.equal(
        child.exitCode,
        null,
        "empty in-progress response is not a failure",
      );
      await writeFile(reply, '{"status":');
      await new Promise((resolve) => setTimeout(resolve, 180));
      assert.equal(child.exitCode, null, "partial JSON is not consumed");
      await writeFile(reply, JSON.stringify({ status: "complete", tools: [] }));
      assert.equal(await done, 0, errors);
      assert.deepEqual(JSON.parse(output), { status: "complete", tools: [] });
      assert.equal(
        (await readdir(join(dir, "commands"))).filter((name) =>
          name.endsWith(".request.json"),
        ).length,
        1,
        "no duplicate command",
      );
    } finally {
      if (child.exitCode === null) {
        child.kill("SIGTERM");
        await done;
      }
      await rm(dir, { recursive: true, force: true });
    }
  },
);
