import { test } from "node:test";
import assert from "node:assert/strict";
import { publicResult, privateArguments } from "../lib/agent-evidence.mjs";

test("agent commands use non-secret body references while only the MCP transport receives capabilities", () => {
  const capabilities = new Map([["rover-01", "private-test-capability"]]);
  const command = { leaseRef: "rover-01", command: { type: "stop" } };
  const wire = privateArguments("act", command, capabilities);
  assert.equal(wire.leaseId, "private-test-capability");
  assert.ok(!JSON.stringify(command).includes("private-test-capability"));
  assert.ok(!Object.hasOwn(wire, "leaseRef"));
  assert.throws(
    () => privateArguments("observe", { leaseRef: "unknown" }, capabilities),
    /Possess/,
  );
  assert.throws(
    () =>
      privateArguments(
        "observe",
        { leaseId: "private-test-capability" },
        capabilities,
      ),
    /leaseRef/,
  );
  assert.throws(
    () => privateArguments("reset", {}, capabilities),
    /Unknown MCP tool/,
  );
});

test("public evidence preserves tool errors, frame identity and inspection results without credentials or pixels", () => {
  const result = publicResult({
    structuredContent: {
      leaseId: "private-test-capability",
      resource: { id: "rover-01" },
      frame: { id: "frame-17", revision: 25, data: "private-image-pixels" },
      inspection: { condition: "Seal intact" },
    },
    _meta: { frameData: "private-image-pixels" },
    content: [{ type: "image", data: "private-image-pixels" }],
  });
  assert.ok(!JSON.stringify(result).includes("private-test-capability"));
  assert.ok(!JSON.stringify(result).includes("private-image-pixels"));
  assert.equal(result.result.frame.id, "frame-17");
  assert.equal(result.result.frame.revision, 25);
  assert.equal(result.result.inspection.condition, "Seal intact");
  const error = publicResult({
    isError: true,
    content: [
      {
        type: "text",
        text: JSON.stringify({ code: "OUT_OF_REACH", message: "Move closer" }),
      },
    ],
  });
  assert.equal(error.isError, true);
  assert.equal(error.result.code, "OUT_OF_REACH");
});
