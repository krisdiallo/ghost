import { test } from "node:test";
import assert from "node:assert/strict";
import type { SensorFrame } from "@ghost/shared";
import { Simulation } from "../src/simulation.js";
import { SensorRenderer } from "../src/renderer.js";
import { startWarehouse } from "../src/http.js";

test("in-flight image captures cannot outlive a lease; spectators retain only completed frames", async () => {
  let now = 0;
  const sim = new Simulation(
    () => now,
    () => 1_000_000 + now,
  );
  const original = SensorRenderer.prototype.capture;
  let finish: (() => void) | undefined;
  let started: (() => void) | undefined;
  let serial = 0;
  SensorRenderer.prototype.capture = async (snapshot, resourceId) => {
    const frame: SensorFrame = {
      id: `test-frame-${++serial}`,
      instanceId: snapshot.instanceId,
      revision: snapshot.revision,
      at: snapshot.at,
      resourceId,
      width: 640,
      height: 360,
      mimeType: "image/jpeg",
      data: "test-only",
    };
    return new Promise((resolve) => {
      finish = () => resolve(frame);
      started?.();
    });
  };
  const warehouse = await startWarehouse(0, "127.0.0.1", sim);
  const address = warehouse.server.address();
  assert.ok(address && typeof address === "object");
  const url = `http://127.0.0.1:${address.port}`;
  const capture = async (leaseId: string) => {
    const began = new Promise<void>((resolve) => {
      started = resolve;
    });
    const response = fetch(url + "/api/tools/observe", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ leaseId, image: true }),
    });
    await began;
    return { response };
  };
  const latest = async () =>
    (await (await fetch(url + "/api/frames/rover-01")).json()) as {
      frame: SensorFrame | null;
    };
  try {
    const expiring = sim.possess("rover-01", 5);
    const pending = await capture(expiring.leaseId);
    now += 6000;
    finish!();
    const expired = await pending.response;
    assert.equal(expired.status, 400);
    assert.equal(
      ((await expired.json()) as { code: string }).code,
      "LEASE_EXPIRED",
    );
    assert.equal((await latest()).frame, null);

    const active = sim.possess("rover-01");
    const successful = await capture(active.leaseId);
    finish!();
    const response = await successful.response;
    assert.equal(response.status, 200);
    const observation = (await response.json()) as {
      frame: SensorFrame;
      revision: number;
    };
    assert.equal(observation.frame.revision, observation.revision);
    assert.equal((await latest()).frame?.id, observation.frame.id);

    const cancelled = await capture(active.leaseId);
    sim.release(active.leaseId);
    finish!();
    const released = await cancelled.response;
    assert.equal(released.status, 400);
    assert.equal(
      ((await released.json()) as { code: string }).code,
      "LEASE_RELEASED",
    );
    assert.equal(
      (await latest()).frame?.id,
      observation.frame.id,
      "cancelled image never replaces the completed frame",
    );

    await fetch(url + "/api/reset", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    });
    assert.equal((await latest()).frame, null, "reset removes captured frames");
  } finally {
    finish?.();
    SensorRenderer.prototype.capture = original;
    await warehouse.close();
  }
});
