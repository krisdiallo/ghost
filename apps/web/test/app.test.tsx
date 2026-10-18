import { test } from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { act, createElement } from "react";
import { Simulation, SimError } from "../../server/src/simulation.js";
import type { Snapshot, ToolName } from "@ghost/shared";

test(
  "live UI possesses, moves, observes, switches bodies, rejects stale snapshots, and recovers connection",
  { timeout: 10000 },
  async () => {
    const dom = new JSDOM(
      '<!doctype html><html><body><div id="root"></div></body></html>',
      { url: "http://localhost:5173", pretendToBeVisual: true },
    );
    const globals: Record<string, unknown> = {
      window: dom.window,
      document: dom.window.document,
      navigator: dom.window.navigator,
      screen: dom.window.screen,
      HTMLElement: dom.window.HTMLElement,
      HTMLCanvasElement: dom.window.HTMLCanvasElement,
      Element: dom.window.Element,
      sessionStorage: dom.window.sessionStorage,
      ResizeObserver: class {
        observe() {}
        unobserve() {}
        disconnect() {}
      },
      requestAnimationFrame: dom.window.requestAnimationFrame.bind(dom.window),
      cancelAnimationFrame: dom.window.cancelAnimationFrame.bind(dom.window),
      IS_REACT_ACT_ENVIRONMENT: true,
    };
    Object.defineProperty(dom.window, "ResizeObserver", {
      value: globals.ResizeObserver,
    });
    const previous = new Map(
      Object.keys(globals).map((key) => [
        key,
        Object.getOwnPropertyDescriptor(globalThis, key),
      ]),
    );
    for (const [key, value] of Object.entries(globals))
      Object.defineProperty(globalThis, key, {
        value,
        configurable: true,
        writable: true,
      });
    let now = 0;
    const sim = new Simulation(
      () => now,
      () => Date.now() + now,
    );
    let stream: FakeEventSource;
    class FakeEventSource {
      onmessage: ((event: { data: string }) => void) | null = null;
      onerror: (() => void) | null = null;
      constructor() {
        stream = this;
        queueMicrotask(() => this.send(sim.snapshot()));
      }
      send(snapshot: Snapshot) {
        this.onmessage?.({ data: JSON.stringify(snapshot) });
      }
      close() {}
    }
    const originalFetch = globalThis.fetch;
    const originalEvents = Object.getOwnPropertyDescriptor(
      globalThis,
      "EventSource",
    );
    Object.defineProperty(globalThis, "EventSource", {
      value: FakeEventSource,
      configurable: true,
      writable: true,
    });
    const unsubscribe = sim.subscribe(() => stream?.send(sim.snapshot()));
    globalThis.fetch = async (input, options) => {
      const path = String(input);
      if (path === "/api/snapshot") return Response.json(sim.snapshot());
      const name = path.split("/").at(-1) as ToolName;
      try {
        return Response.json(sim.tool(name, JSON.parse(String(options?.body))));
      } catch (error) {
        return Response.json(
          {
            code: error instanceof SimError ? error.code : "ERROR",
            message: (error as Error).message,
          },
          { status: 400 },
        );
      }
    };
    const { createRoot } = await import("react-dom/client");
    const { App } = await import("../src/App.js");
    const root = createRoot(document.getElementById("root")!);
    const button = (label: string) => {
      const found = [...document.querySelectorAll("button")].find(
        (b) => b.textContent?.trim() === label,
      );
      assert.ok(found, `button exists: ${label}`);
      return found;
    };
    const click = async (label: string) => {
      await act(async () => {
        button(label).click();
      });
    };
    try {
      await act(async () => {
        root.render(createElement(App));
      });
      assert.match(document.body.textContent!, /Systems live/);
      assert.match(
        document.querySelector(".survey-panel")!.textContent!,
        /No cargo observed yet/,
      );
      assert.equal(
        document
          .querySelector('[role="progressbar"]')!
          .getAttribute("aria-valuenow"),
        "0",
      );
      await click("Survey on");
      assert.equal(
        document.querySelector('[aria-label="Survey coverage grid"]'),
        null,
      );
      await click("Survey off");
      assert.ok(document.querySelector('[aria-label="Survey coverage grid"]'));
      await click("Possess body");
      assert.match(document.body.textContent!, /YOU ARE IN CONTROL/);
      assert.equal(sim.snapshot().bodies[1]!.lease!.owner, "You · browser");
      const beforeMove = sim.snapshot();
      await click("Move to point");
      assert.match(document.body.textContent!, /IN MOTION/);
      await act(async () => {
        now += 4500;
        sim.tick();
      });
      assert.match(document.body.textContent!, /move · completed/);
      await click("Scan priority cargo");
      assert.match(
        document.querySelector(".survey-ledger")!.textContent!,
        /Cleared for dispatch/,
      );
      assert.match(
        document.querySelector(".survey-ledger")!.textContent!,
        /1 \/ 1 inspected/,
      );
      await click("Observation");
      assert.match(document.body.textContent!, /Seal intact/);
      assert.match(document.body.textContent!, /crate-07/);
      await act(async () => {
        stream.send(beforeMove);
      });
      // Older revisions must not rewind the pose or mission progress.
      assert.equal(sim.snapshot().mission[1]!.complete, true);
      assert.match(document.querySelector(".mission-count")!.textContent!, /1/);
      await act(async () => {
        stream.onerror?.();
      });
      assert.match(document.body.textContent!, /Connection interrupted/);
      await act(async () => {
        stream.send(sim.snapshot());
      });
      assert.match(document.body.textContent!, /Systems live/);
      const sentinel = [...document.querySelectorAll("button")].find(
        (b) =>
          b.classList.contains("body-card") &&
          b.textContent?.includes("Sentinel"),
      )!;
      await act(async () => {
        sentinel.click();
      });
      await click("Possess body");
      assert.equal(
        sim.snapshot().bodies[1]!.lease,
        null,
        "switching releases previous body",
      );
      assert.equal(sim.snapshot().bodies[0]!.lease!.owner, "You · browser");
      await click("Release body");
      assert.ok(sim.snapshot().bodies.every((b) => !b.lease));
      await act(async () => {
        stream.onerror?.();
      });
      assert.ok(
        button("Possess body").disabled,
        "offline controls are disabled",
      );
    } finally {
      await act(async () => {
        root.unmount();
      });
      unsubscribe();
      globalThis.fetch = originalFetch;
      if (originalEvents)
        Object.defineProperty(globalThis, "EventSource", originalEvents);
      else Reflect.deleteProperty(globalThis, "EventSource");
      for (const [key, descriptor] of previous) {
        if (descriptor) Object.defineProperty(globalThis, key, descriptor);
        else Reflect.deleteProperty(globalThis, key);
      }
      dom.window.close();
    }
  },
);
