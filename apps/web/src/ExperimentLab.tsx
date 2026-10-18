import { useEffect, useMemo, useRef, useState } from "react";
import {
  defaultProfile,
  bodyClearance,
  type Body,
  type Command,
  type DeviceDefinition,
  type WarehouseDefinition,
  type WorkflowDefinition,
  type SandboxDetail,
  type LabState,
  type RunDetail,
  type ExperimentTemplate,
  type ExperimentComparison,
  type Vec3,
} from "@ghost/shared";
import { tool } from "./api";
import { Warehouse, type WarehouseView } from "./Warehouse";
import { Ghost, BodyIcon, UIIcon } from "./icons";
import "./lab.css";

function initialWorkflow(d: WarehouseDefinition): WorkflowDefinition {
  return (
    d.workflow ?? {
      name: "Inspection trial",
      actors: {
        vehicle: (d.devices.find((d) => d.kind === "drone") ?? d.devices[0]!)
          .id,
      },
      steps: [],
      stopOnError: true,
      maxSimulatedSeconds: 180,
      requireSafeEnd: true,
    }
  );
}
function download(name: string, value: unknown) {
  const url = URL.createObjectURL(
    new Blob([JSON.stringify(value, null, 2)], { type: "application/json" }),
  );
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}
const number = (value: number, digits = 1) => value.toFixed(digits);
const statusLabel = (value: string) =>
  ({
    running: "Running",
    completed: "Completed",
    failed: "Failed",
    cancelled: "Cancelled",
  })[value] ?? value;
function commandText(c: Command) {
  if (c.type === "move")
    return (
      "Move to " +
      [c.x, c.y, c.z].filter((v) => v !== undefined).join(" / ") +
      " m"
    );
  if (c.type === "inspect" || c.type === "grasp")
    return c.type + " " + c.objectId;
  if (c.type === "look") return "Aim " + c.pan + "° / " + c.tilt + "°";
  if (c.type === "preset") return "Arm → " + c.preset;
  return c.type;
}
export function ExperimentLab() {
  const [lab, setLab] = useState<LabState | null>(null),
    [live, setLive] = useState(false);
  const [draft, setDraft] = useState<SandboxDetail | null>(null),
    [definition, setDefinition] = useState<WarehouseDefinition | null>(null);
  const [workflow, setWorkflow] = useState<WorkflowDefinition | null>(null);
  const [runId, setRunId] = useState<string | null>(null),
    [run, setRun] = useState<RunDetail | null>(null);
  const [tab, setTab] = useState<"fleet" | "layout" | "workflow" | "results">(
    "fleet",
  );
  const [busy, setBusy] = useState(false),
    [progress, setProgress] = useState(""),
    [error, setError] = useState("");
  const [selected, setSelected] = useState(""),
    [view, setView] = useState<WarehouseView>("facility");
  const [mode, setMode] = useState<"orbit" | "pan">("orbit"),
    [zoom, setZoom] = useState({ id: 0, factor: 1 }),
    [reset, setReset] = useState(0);
  const [focusing, setFocusing] = useState(false);
  const [bodyCamera, setBodyCamera] = useState(false),
    [frame, setFrame] = useState<{
      url: string;
      revision: number;
      resourceId: string;
    } | null>(null);
  const [checked, setChecked] = useState<string[]>([]),
    [comparison, setComparison] = useState<ExperimentComparison | null>(null);
  const [obstacleId, setObstacleId] = useState(""),
    [importText, setImportText] = useState(""),
    [advanced, setAdvanced] = useState(false);
  const [deviceKind, setDeviceKind] =
      useState<DeviceDefinition["kind"]>("drone"),
    [deviceName, setDeviceName] = useState("Prototype drone");
  const [stepType, setStepType] = useState<Command["type"]>("move"),
    [stepActor, setStepActor] = useState("vehicle");
  const [x, setX] = useState("-10"),
    [y, setY] = useState("2.8"),
    [z, setZ] = useState("-21"),
    [objectId, setObjectId] = useState("crate-12");
  const [pan, setPan] = useState("28"),
    [tilt, setTilt] = useState("-34"),
    [preset, setPreset] = useState<"home" | "reach" | "drop">("home");
  const [dwell, setDwell] = useState("0");
  const [playback, setPlayback] = useState(4);
  const loadSerial = useRef(0);
  const working = useMemo(() => {
    if (!definition) return null;
    const { workflow: old, ...base } = definition;
    return {
      ...base,
      ...(workflow?.steps.length ? { workflow } : {}),
    } as WarehouseDefinition;
  }, [definition, workflow]);
  const dirty =
    !!draft &&
    !!working &&
    JSON.stringify(working) !== JSON.stringify(draft.definition);
  async function refresh() {
    const next = await tool<LabState>("sandbox_list", {});
    setLab(next);
    setLive(true);
  }
  useEffect(() => {
    let alive = true,
      fetching = false;
    const poll = async () => {
      if (fetching) return;
      fetching = true;
      try {
        const next = await tool<LabState>("sandbox_list", {});
        if (alive) {
          setLab(next);
          setLive(true);
        }
      } catch {
        if (alive) setLive(false);
      } finally {
        fetching = false;
      }
    };
    void poll();
    const timer = setInterval(() => void poll(), 1000);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, []);
  useEffect(() => {
    if (!runId) return;
    let alive = true,
      fetching = false;
    const poll = async () => {
      if (fetching) return;
      fetching = true;
      try {
        const detail = await tool<RunDetail>("experiment_inspect", {
          runId,
          includeSnapshot: true,
        });
        if (alive) setRun(detail);
      } catch (e) {
        if (alive)
          setError(e instanceof Error ? e.message : "Run unavailable.");
      } finally {
        fetching = false;
      }
    };
    void poll();
    const timer = setInterval(() => void poll(), 300);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [runId]);
  async function perform(fn: () => Promise<void>) {
    setBusy(true);
    setError("");
    try {
      await fn();
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "The operation failed.");
    } finally {
      setBusy(false);
      setProgress("");
    }
  }
  function accept(d: SandboxDetail) {
    setDraft(d);
    setDefinition(structuredClone(d.definition));
    setWorkflow(initialWorkflow(d.definition));
    setRunId(null);
    setRun(null);
    setFrame(null);
    setSelected(d.definition.devices[0]?.id ?? "");
    setObstacleId("");
    setBodyCamera(false);
  }
  async function choose(id: string, force = false) {
    if (dirty && !force) {
      setError("Save or discard your draft changes before switching.");
      return;
    }
    const serial = ++loadSerial.current;
    await perform(async () => {
      const d = await tool<SandboxDetail>("sandbox_inspect", { sandboxId: id });
      if (serial === loadSerial.current) accept(d);
    });
  }
  async function save() {
    if (!draft || !working) return null;
    const result = await tool<SandboxDetail>("sandbox_update", {
      sandboxId: draft.sandbox.id,
      expectedRevision: draft.sandbox.revision,
      definition: working,
    });
    setDraft(result);
    setDefinition(structuredClone(result.definition));
    setWorkflow(initialWorkflow(result.definition));
    return result;
  }
  async function clone(source?: string) {
    await perform(async () => {
      const d = await tool<SandboxDetail>("sandbox_create", {
        name:
          "Warehouse trial " +
          String((lab?.sandboxes.length ?? 0) + 1).padStart(2, "0"),
        ...(source ? { sourceSandboxId: source } : {}),
      });
      accept(d);
      setTab("fleet");
    });
  }
  async function start() {
    if (!draft || !workflow?.steps.length) return;
    await perform(async () => {
      const d = dirty ? await save() : draft;
      if (!d) return;
      const next = await tool<RunDetail>("experiment_run", {
        sandboxId: d.sandbox.id,
        expectedRevision: d.sandbox.revision,
        workflow,
        playbackRate: playback,
      });
      setRun(next);
      setRunId(next.run.id);
      setFrame(null);
      setTab("results");
      setBodyCamera(false);
      setSelected(
        Object.values(workflow.actors)[0] ?? d.definition.devices[0]!.id,
      );
    });
  }
  async function starter() {
    if (dirty) {
      setError(
        "Save or discard changes before opening the comparison example.",
      );
      return;
    }
    await perform(async () => {
      setProgress("Cloning the warehouse…");
      const { templates } = await tool<{ templates: ExperimentTemplate[] }>(
        "experiment_templates",
        {},
      );
      const t = templates[0]!;
      const runIds: string[] = [];
      let baseline: WarehouseDefinition | undefined,
        last: SandboxDetail | undefined;
      for (const variant of t.variants) {
        const d = await tool<SandboxDetail>("sandbox_create", {
          name: variant.name,
          ...(baseline ? { definition: baseline } : {}),
        });
        baseline ??= structuredClone(d.definition);
        setProgress("Adding " + variant.name.toLowerCase() + "…");
        const def = structuredClone(d.definition);
        def.devices.push({
          ...t.device,
          label: variant.name,
          profile: { ...t.device.profile, scale: variant.scale },
        });
        def.workflow = t.workflow;
        last = await tool<SandboxDetail>("sandbox_update", {
          sandboxId: d.sandbox.id,
          expectedRevision: 0,
          definition: def,
        });
        const next = await tool<RunDetail>("experiment_run", {
          sandboxId: d.sandbox.id,
          expectedRevision: last.sandbox.revision,
          playbackRate: 4,
        });
        runIds.push(next.run.id);
        setRun(next);
      }
      if (last) {
        accept(last);
        setSelected("trial-drone");
      }
      setChecked(runIds);
      setComparison(null);
      setRunId(runIds.at(-1)!);
      setTab("results");
    });
  }
  const source = runId ? run?.snapshot : draft?.snapshot;
  const preview = useMemo(() => {
    if (!source) return null;
    if (runId || !working) return source;
    return {
      ...source,
      layout: { obstacles: working.obstacles },
      bodies: working.devices.map((d) => {
        const previous = source.bodies.find((b) => b.id === d.id);
        const position = [...d.position] as Vec3;
        if (d.kind === "rover") position[1] = 0.45 * d.profile.scale;
        if (d.kind === "drone" && !d.airborne)
          position[1] = 0.4 * d.profile.scale;
        return {
          ...previous,
          ...d,
          position,
          heading: d.heading ?? Math.PI,
          pan: d.pan ?? 180,
          tilt: d.tilt ?? -35,
          airborne: d.airborne ?? false,
          preset: "home",
          heldObjectId: null,
          lease: null,
          action: null,
          lastBlocked: null,
        } as Body;
      }),
    };
  }, [source, runId, working]);
  const devices = runId ? run?.run.definition.devices : working?.devices;
  const selectedDevice =
    devices?.find((d) => d.id === selected) ?? devices?.[0];
  const sceneSelected = preview?.bodies.some((b) => b.id === selected)
    ? selected
    : (preview?.bodies[0]?.id ?? "");
  // Freeze the focus preset anchor; follow updates translation during a trial.
  const focusPoint = useMemo(() => {
    const body = preview?.bodies.find((b) => b.id === sceneSelected);
    return focusing && body ? ([...body.position] as Vec3) : null;
  }, [focusing, sceneSelected, reset]);
  const obstacle = working?.obstacles.find((o) => o.id === obstacleId);
  const canEdit = !!draft && !runId && !busy && live;
  const currentReport = run?.run;
  const changeDevice = (id: string, patch: Partial<DeviceDefinition>) =>
    setDefinition((d) =>
      d
        ? {
            ...d,
            devices: d.devices.map((v) =>
              v.id === id ? { ...v, ...patch } : v,
            ),
          }
        : d,
    );
  function addStep() {
    if (!workflow) return;
    const actor = Object.hasOwn(workflow.actors, stepActor)
      ? stepActor
      : Object.keys(workflow.actors)[0]!;
    let command: Command;
    if (stepType === "move") {
      const bound = working?.devices.find(
        (d) => d.id === workflow.actors[actor],
      );
      command = {
        type: "move",
        x: Number(x),
        z: Number(z),
        ...(bound?.kind === "drone" ? { y: Number(y) } : {}),
      };
    } else if (stepType === "look")
      command = { type: "look", pan: Number(pan), tilt: Number(tilt) };
    else if (stepType === "inspect" || stepType === "grasp")
      command = { type: stepType, objectId };
    else if (stepType === "preset") command = { type: "preset", preset };
    else command = { type: stepType };
    setWorkflow({
      ...workflow,
      steps: [
        ...workflow.steps,
        { actor, command, dwellSeconds: Number(dwell) },
      ],
    });
  }
  return (
    <main className="experiment-lab">
      <header className="lab-header">
        <a href="#" className="lab-brand">
          <Ghost size={28} />
          <strong>
            GHOST<span> / EXPERIMENT LAB</span>
          </strong>
        </a>
        <div className="lab-header-actions">
          <span
            className={"connection " + (live ? "live" : "disconnected")}
            role="status"
          >
            <i />
            {live ? "Lab connected" : "Reconnecting"}
          </span>
          <a className="lab-back" href="#">
            ← Live warehouse
          </a>
        </div>
      </header>
      <section className="lab-heading">
        <div>
          <div className="lab-eyebrow">SIMULATE / OBSERVE / COMPARE</div>
          <h1>Test your next fleet.</h1>
          <p>
            Your warehouse. A temporary fleet. Evidence before the investment.
          </p>
        </div>
        <button
          className="lab-primary"
          disabled={busy || !live || dirty || (lab?.sandboxes.length ?? 0) > 6}
          onClick={() => void starter()}
        >
          Run aisle fit comparison{" "}
          <span aria-hidden="true">
            <UIIcon name="arrow" />
          </span>
        </button>
      </section>
      <div className="lab-model-note">
        <span>ISOLATED BY DESIGN</span> Runs fork the layout and starting state.
        The live warehouse stays independent.{" "}
        <span className="lab-memory">
          Session memory · export JSON to keep your work
        </span>
      </div>
      {error && (
        <div className="lab-alert" role="alert">
          {error}
          <button aria-label="Dismiss lab error" onClick={() => setError("")}>
            ×
          </button>
        </div>
      )}
      {!live && (
        <div className="lab-alert" role="status">
          Connection interrupted. Showing the last available state; controls
          resume on reconnection.
        </div>
      )}
      {progress && (
        <div className="lab-progress" role="status">
          {progress}
        </div>
      )}
      <div className="lab-grid">
        <aside className="lab-sidebar lab-panel">
          <div className="lab-section-title">
            <h2>Sandboxes</h2>
            <span>{lab?.sandboxes.length ?? 0} / 8</span>
          </div>
          <button
            className="lab-secondary lab-full"
            disabled={busy || !live || dirty}
            onClick={() => void clone()}
          >
            ＋ Clone live warehouse
          </button>
          <div className="lab-draft-list">
            {lab?.sandboxes.map((s) => (
              <button
                key={s.id}
                className={
                  "lab-draft " + (draft?.sandbox.id === s.id ? "selected" : "")
                }
                disabled={busy}
                onClick={() => void choose(s.id)}
              >
                <span className="lab-draft-icon">◇</span>
                <span>
                  <strong>{s.name}</strong>
                  <small>
                    {s.deviceCount} devices · {s.obstacleCount} structures
                  </small>
                </span>
                <span aria-hidden="true">
                  <UIIcon name="arrow" />
                </span>
              </button>
            ))}
            {!lab?.sandboxes.length && (
              <p className="lab-muted">
                Clone a warehouse to try new devices without changing the
                source.
              </p>
            )}
          </div>
          <details className="lab-import">
            <summary>Import a saved sandbox</summary>
            <label>
              Version 1 definition JSON
              <textarea
                aria-label="Sandbox JSON import"
                value={importText}
                onChange={(e) => setImportText(e.target.value)}
                placeholder='{"version":1,"name":"Warehouse",…}'
              />
            </label>
            <button
              disabled={busy || !live || dirty || !importText.trim()}
              onClick={() =>
                void perform(async () => {
                  const value = JSON.parse(importText) as WarehouseDefinition;
                  const d = await tool<SandboxDetail>("sandbox_create", {
                    name: value.name,
                    definition: value,
                  });
                  accept(d);
                  setImportText("");
                })
              }
            >
              Import JSON
            </button>
          </details>
          <div className="lab-section-title lab-runs-title">
            <h2>Run history</h2>
            <span>{lab?.runs.length ?? 0}</span>
          </div>
          <p className="lab-muted">Select up to four runs for comparison.</p>
          <div className="lab-run-list">
            {lab?.runs.map((r) => (
              <div
                key={r.id}
                className={"lab-run " + (runId === r.id ? "selected" : "")}
              >
                <input
                  type="checkbox"
                  aria-label={"Compare " + r.sandboxName + " " + r.id}
                  checked={checked.includes(r.id)}
                  disabled={!checked.includes(r.id) && checked.length >= 4}
                  onChange={(e) => {
                    setChecked(
                      e.target.checked
                        ? [...checked, r.id]
                        : checked.filter((id) => id !== r.id),
                    );
                    setComparison(null);
                  }}
                />
                <button
                  onClick={() => {
                    if (dirty) {
                      setError("Save or discard changes before viewing a run.");
                      return;
                    }
                    setRun(null);
                    setRunId(r.id);
                    setTab("results");
                    setBodyCamera(false);
                    setFrame(null);
                  }}
                >
                  <strong>{r.sandboxName}</strong>
                  <span className={"lab-status " + r.status}>
                    {statusLabel(r.status)}
                  </span>
                  <small>
                    {r.metrics.completedSteps}/{r.metrics.totalSteps} steps ·{" "}
                    {number(r.metrics.simulatedSeconds)} sim s
                  </small>
                </button>
              </div>
            ))}
          </div>
          <button
            className="lab-secondary lab-full"
            disabled={
              busy ||
              !live ||
              checked.length < 2 ||
              checked.some(
                (id) =>
                  lab?.runs.find((r) => r.id === id)?.status === "running",
              )
            }
            onClick={() =>
              void perform(async () =>
                setComparison(
                  await tool<ExperimentComparison>("experiment_compare", {
                    runIds: checked,
                  }),
                ),
              )
            }
          >
            {checked.some(
              (id) => lab?.runs.find((r) => r.id === id)?.status === "running",
            )
              ? "Waiting for selected trials…"
              : "Compare selected (" + checked.length + ")"}
          </button>
        </aside>
        <section className="lab-center">
          <div className="lab-panel lab-viewport">
            <div className="lab-scene-header">
              <div>
                <span className="lab-scene-badge">
                  {runId
                    ? "TRIAL FORK"
                    : dirty
                      ? "UNSAVED PREVIEW"
                      : "SANDBOX DRAFT"}
                </span>
                <h2>
                  {runId
                    ? currentReport?.sandboxName
                    : (draft?.sandbox.name ?? "Your next experiment")}
                </h2>
              </div>
              {runId && currentReport && (
                <span className={"lab-status " + currentReport.status}>
                  {statusLabel(currentReport.status)}
                </span>
              )}
            </div>
            <div className="lab-scene">
              {preview ? (
                <Warehouse
                  snapshot={preview}
                  selected={sceneSelected}
                  onSelect={setSelected}
                  navigate={null}
                  focus={focusPoint}
                  follow={focusing}
                  view={view}
                  mode={mode}
                  reset={reset}
                  zoom={zoom}
                  sensorId={bodyCamera ? sceneSelected : undefined}
                />
              ) : (
                <div className="lab-empty">
                  <Ghost size={60} />
                  <h2>Start with your warehouse.</h2>
                  <p>
                    Clone the floorplan. Add a candidate device.
                    <br />
                    Run a workflow and inspect what happens.
                  </p>
                  <button
                    className="lab-primary"
                    disabled={busy || !live}
                    onClick={() => void clone()}
                  >
                    Create your first sandbox
                  </button>
                </div>
              )}
            </div>
            <div
              className="lab-view-tools"
              role="group"
              aria-label="Experiment camera controls"
            >
              <button
                disabled={!preview}
                aria-pressed={view === "facility" && !bodyCamera && !focusing}
                onClick={() => {
                  setFocusing(false);
                  setView("facility");
                  setBodyCamera(false);
                  setReset((r) => r + 1);
                }}
              >
                Overview
              </button>
              <button
                disabled={!preview}
                aria-pressed={view === "top" && !bodyCamera && !focusing}
                onClick={() => {
                  setFocusing(false);
                  setView("top");
                  setBodyCamera(false);
                  setReset((r) => r + 1);
                }}
              >
                Top view
              </button>
              <button
                disabled={!preview}
                aria-pressed={bodyCamera}
                onClick={() => setBodyCamera((v) => !v)}
              >
                Body camera
              </button>
              <button
                disabled={!preview}
                aria-pressed={focusing && !bodyCamera}
                onClick={() => {
                  setFocusing(true);
                  setBodyCamera(false);
                  setReset((r) => r + 1);
                }}
              >
                Focus device
              </button>
              <button
                aria-pressed={mode === "pan"}
                onClick={() => setMode((m) => (m === "pan" ? "orbit" : "pan"))}
              >
                {mode === "pan" ? "Pan" : "Orbit"}
              </button>
              <button
                aria-label="Zoom experiment in"
                onClick={() => setZoom((q) => ({ id: q.id + 1, factor: 0.8 }))}
              >
                ＋
              </button>
              <button
                aria-label="Zoom experiment out"
                onClick={() => setZoom((q) => ({ id: q.id + 1, factor: 1.25 }))}
              >
                −
              </button>
            </div>
            {devices && (
              <div className="lab-fleet-strip">
                {devices.map((d) => (
                  <button
                    key={d.id}
                    aria-pressed={sceneSelected === d.id}
                    onClick={() => setSelected(d.id)}
                  >
                    <BodyIcon kind={d.kind} />
                    {d.label}
                  </button>
                ))}
              </div>
            )}
          </div>
          {currentReport && runId && (
            <div className="lab-live-results lab-panel">
              <div className="lab-section-title">
                <h2>{currentReport.name}</h2>
                <span>{currentReport.playbackRate}× playback</span>
              </div>
              <div className="lab-metrics">
                <div>
                  <strong>
                    {currentReport.metrics.completedSteps}
                    <small> / {currentReport.metrics.totalSteps}</small>
                  </strong>
                  <span>steps completed</span>
                </div>
                <div>
                  <strong>
                    {number(currentReport.metrics.simulatedSeconds)}
                    <small> s</small>
                  </strong>
                  <span>simulated time</span>
                </div>
                <div>
                  <strong>
                    {number(currentReport.metrics.distanceMeters)}
                    <small> m</small>
                  </strong>
                  <span>distance travelled</span>
                </div>
                <div>
                  <strong>{currentReport.metrics.blockedMoves}</strong>
                  <span>blocked moves</span>
                </div>
              </div>
              {currentReport.error && (
                <div className="lab-run-error">
                  <strong>{currentReport.error.code}</strong>
                  <p>{currentReport.error.message}</p>
                </div>
              )}
              <div className="lab-report-actions">
                <span>
                  {currentReport.metrics.allLeasesReleased
                    ? "All trial leases released"
                    : "Trial owns its device leases"}{" "}
                  ·{" "}
                  {currentReport.status === "running"
                    ? "Workflow in progress"
                    : currentReport.metrics.safeEndState
                      ? "Devices at rest"
                      : "Recovery needed"}
                </span>
                {currentReport.status === "running" ? (
                  <button
                    className="lab-danger"
                    disabled={busy || !live}
                    onClick={() =>
                      void perform(async () => {
                        await tool("experiment_cancel", { runId });
                      })
                    }
                  >
                    Stop trial
                  </button>
                ) : (
                  <button
                    onClick={() =>
                      download(currentReport.id + ".json", currentReport)
                    }
                  >
                    Export report
                  </button>
                )}
              </div>
            </div>
          )}
          {comparison && (
            <section
              className="lab-panel lab-comparison"
              aria-label="Experiment comparison"
            >
              <div className="lab-section-title">
                <h2>Compare the evidence</h2>
                <span
                  className={
                    "lab-status " +
                    (comparison.comparable ? "completed" : "failed")
                  }
                >
                  {comparison.comparable
                    ? "Same starting conditions"
                    : "Different conditions"}
                </span>
              </div>
              <p>{comparison.interpretation}</p>
              {comparison.reasons.map((r) => (
                <p className="lab-compare-reason" key={r}>
                  {r}
                </p>
              ))}
              <div className="lab-table-scroll">
                <table>
                  <thead>
                    <tr>
                      <th>Candidate</th>
                      <th>Outcome</th>
                      <th>Steps</th>
                      <th>Sim s</th>
                      <th>Distance</th>
                      <th>Blocked</th>
                    </tr>
                  </thead>
                  <tbody>
                    {comparison.runs.map((r) => (
                      <tr key={r.id}>
                        <th>{r.sandboxName}</th>
                        <td>
                          <span className={"lab-status " + r.status}>
                            {statusLabel(r.status)}
                          </span>
                        </td>
                        <td>
                          {r.metrics.completedSteps}/{r.metrics.totalSteps}
                        </td>
                        <td>{number(r.metrics.simulatedSeconds)}</td>
                        <td>{number(r.metrics.distanceMeters)} m</td>
                        <td>{r.metrics.blockedMoves}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {comparison.delta && (
                <p>
                  Second minus first:{" "}
                  {number(comparison.delta.simulatedSeconds)} simulated seconds;{" "}
                  {number(comparison.delta.distanceMeters)} m.
                </p>
              )}
              <button
                onClick={() => download("ghost-comparison.json", comparison)}
              >
                Export comparison
              </button>
            </section>
          )}
        </section>
        <section className="lab-panel lab-inspector">
          <div
            className="lab-tabs"
            role="tablist"
            aria-label="Experiment workspace"
          >
            {(["fleet", "layout", "workflow", "results"] as const).map((t) => (
              <button
                key={t}
                role="tab"
                aria-selected={tab === t}
                onClick={() => {
                  setTab(t);
                  if (t !== "results") {
                    setRunId(null);
                    setBodyCamera(false);
                    setFrame(null);
                  }
                }}
              >
                {t}
              </button>
            ))}
          </div>
          {draft && working && tab !== "results" ? (
            <div className="lab-editor">
              <div className="lab-save-bar">
                <span>
                  {dirty ? "● Unsaved changes" : "✓ Draft saved"}
                  <small>Revision {draft.sandbox.revision}</small>
                </span>
                <button
                  className="lab-primary"
                  disabled={!canEdit || !dirty}
                  onClick={() =>
                    void perform(async () => {
                      await save();
                    })
                  }
                >
                  Save draft
                </button>
              </div>
              {dirty && (
                <button
                  className="lab-text-button"
                  disabled={busy}
                  onClick={() => void choose(draft.sandbox.id, true)}
                >
                  Discard changes
                </button>
              )}
              {tab === "fleet" && (
                <>
                  <label>
                    Sandbox name
                    <input
                      value={working.name}
                      maxLength={80}
                      disabled={!canEdit}
                      onChange={(e) =>
                        setDefinition((d) =>
                          d ? { ...d, name: e.target.value } : d,
                        )
                      }
                    />
                  </label>
                  <div className="lab-section-title">
                    <h3>Candidate devices</h3>
                    <span>{working.devices.length} / 12</span>
                  </div>
                  <div className="lab-device-select">
                    {working.devices.map((d) => (
                      <button
                        key={d.id}
                        aria-pressed={selectedDevice?.id === d.id}
                        onClick={() => setSelected(d.id)}
                      >
                        <BodyIcon kind={d.kind} />
                        <span>
                          {d.label}
                          <small>
                            {d.kind} · {Math.round(d.profile.scale * 100)}%
                            scale
                          </small>
                        </span>
                      </button>
                    ))}
                  </div>
                  {selectedDevice && (
                    <fieldset disabled={!canEdit} className="lab-fields">
                      <label>
                        Device name
                        <input
                          value={selectedDevice.label}
                          maxLength={80}
                          onChange={(e) =>
                            changeDevice(selectedDevice.id, {
                              label: e.target.value,
                            })
                          }
                        />
                      </label>
                      <label>
                        Physical scale{" "}
                        <strong>
                          {Math.round(selectedDevice.profile.scale * 100)}%
                        </strong>
                        <input
                          type="range"
                          min=".5"
                          max="1.5"
                          step=".05"
                          value={selectedDevice.profile.scale}
                          onChange={(e) =>
                            changeDevice(selectedDevice.id, {
                              profile: {
                                ...selectedDevice.profile,
                                scale: Number(e.target.value),
                              },
                            })
                          }
                        />
                      </label>
                      <p className="lab-muted">
                        {selectedDevice.kind === "rover" ||
                        selectedDevice.kind === "drone" ? (
                          <>
                            Envelope:{" "}
                            {number(
                              bodyClearance(selectedDevice as Body)[0] * 2,
                              2,
                            )}{" "}
                            ×{" "}
                            {number(
                              bodyClearance(selectedDevice as Body)[2] * 2,
                              2,
                            )}{" "}
                            m. Scale changes visible size and checked clearance.
                          </>
                        ) : (
                          <>
                            Fixed mount. Scale changes the body, camera offsets
                            and arm reach.
                          </>
                        )}
                      </p>
                      <div className="lab-input-grid">
                        <label>
                          Speed · m/s
                          <input
                            type="number"
                            min=".2"
                            max="6"
                            step=".1"
                            disabled={
                              selectedDevice.kind !== "rover" &&
                              selectedDevice.kind !== "drone"
                            }
                            value={selectedDevice.profile.speed}
                            onChange={(e) =>
                              changeDevice(selectedDevice.id, {
                                profile: {
                                  ...selectedDevice.profile,
                                  speed: Number(e.target.value),
                                },
                              })
                            }
                          />
                        </label>
                        <label>
                          Sensor range · m
                          <input
                            type="number"
                            min="1"
                            max="60"
                            step="1"
                            value={selectedDevice.profile.telemetryRange}
                            onChange={(e) =>
                              changeDevice(selectedDevice.id, {
                                profile: {
                                  ...selectedDevice.profile,
                                  telemetryRange: Number(e.target.value),
                                },
                              })
                            }
                          />
                        </label>
                        {selectedDevice.kind === "arm" ? (
                          <label>
                            Payload · kg
                            <input
                              type="number"
                              min="0"
                              max="100"
                              value={selectedDevice.profile.payloadKg ?? 0}
                              onChange={(e) =>
                                changeDevice(selectedDevice.id, {
                                  profile: {
                                    ...selectedDevice.profile,
                                    payloadKg: Number(e.target.value),
                                  },
                                })
                              }
                            />
                          </label>
                        ) : (
                          <label>
                            Inspect range · m
                            <input
                              type="number"
                              min=".5"
                              max="60"
                              step=".1"
                              value={selectedDevice.profile.inspectRange ?? 0}
                              onChange={(e) =>
                                changeDevice(selectedDevice.id, {
                                  profile: {
                                    ...selectedDevice.profile,
                                    inspectRange: Number(e.target.value),
                                  },
                                })
                              }
                            />
                          </label>
                        )}
                        {(selectedDevice.kind === "camera" ||
                        selectedDevice.kind === "arm"
                          ? [0, 1, 2]
                          : [0, 2]
                        ).map((i) => (
                          <label key={i}>
                            Placement {["X", "Y", "Z"][i]} · m
                            <input
                              type="number"
                              step=".1"
                              value={selectedDevice.position[i]}
                              onChange={(e) => {
                                const p = [...selectedDevice.position] as Vec3;
                                p[i] = Number(e.target.value);
                                changeDevice(selectedDevice.id, {
                                  position: p,
                                });
                              }}
                            />
                          </label>
                        ))}
                      </div>
                      <button
                        className="lab-text-button lab-red"
                        disabled={
                          working.devices.length <= 1 ||
                          (!!workflow?.steps.length &&
                            Object.values(workflow.actors).includes(
                              selectedDevice.id,
                            ))
                        }
                        onClick={() => {
                          setDefinition((d) =>
                            d
                              ? {
                                  ...d,
                                  devices: d.devices.filter(
                                    (v) => v.id !== selectedDevice.id,
                                  ),
                                }
                              : d,
                          );
                          setSelected("");
                          if (workflow && !workflow.steps.length) {
                            const next = working.devices.find(
                              (d) => d.id !== selectedDevice.id,
                            );
                            if (next)
                              setWorkflow({
                                ...workflow,
                                actors: { vehicle: next.id },
                              });
                          }
                        }}
                      >
                        Remove this device
                      </button>
                    </fieldset>
                  )}
                  <div className="lab-add-device">
                    <h3>Add a temporary body</h3>
                    <label>
                      Body type
                      <select
                        value={deviceKind}
                        onChange={(e) => {
                          setDeviceKind(
                            e.target.value as DeviceDefinition["kind"],
                          );
                          setDeviceName("Prototype " + e.target.value);
                        }}
                      >
                        <option value="drone">Drone</option>
                        <option value="rover">Rover</option>
                        <option value="camera">Fixed camera</option>
                        <option value="arm">Robotic arm</option>
                      </select>
                    </label>
                    <label>
                      New device name
                      <input
                        value={deviceName}
                        maxLength={80}
                        onChange={(e) => setDeviceName(e.target.value)}
                      />
                    </label>
                    <button
                      className="lab-secondary lab-full"
                      disabled={
                        !canEdit ||
                        working.devices.length >= 12 ||
                        !deviceName.trim()
                      }
                      onClick={() => {
                        const id =
                          "prototype-" +
                          deviceKind +
                          "-" +
                          crypto.randomUUID().slice(0, 6);
                        const positions = {
                          drone: [-20, 0.4, -10],
                          rover: [-10, 0.45, 3],
                          camera: [-30.2, 10, 8],
                          arm: [4, 0.5, 0],
                        };
                        setDefinition((d) =>
                          d
                            ? {
                                ...d,
                                devices: [
                                  ...d.devices,
                                  {
                                    id,
                                    kind: deviceKind,
                                    label: deviceName,
                                    position: positions[deviceKind] as Vec3,
                                    profile: defaultProfile(deviceKind),
                                    airborne: false,
                                  },
                                ],
                              }
                            : d,
                        );
                        setSelected(id);
                      }}
                    >
                      ＋ Add device to draft
                    </button>
                  </div>
                </>
              )}
              {tab === "layout" && (
                <>
                  <h3>Warehouse layout</h3>
                  <p className="lab-muted">
                    64 × 44 m hall. Select a structure to move or resize its
                    solid envelope. Saves validate every device spawn.
                  </p>
                  <svg
                    className="lab-floorplan"
                    viewBox="0 0 320 220"
                    role="group"
                    aria-label="Editable sandbox floorplan"
                  >
                    <rect x="0" y="0" width="320" height="220" fill="#132b36" />
                    {working.obstacles.map((o) => (
                      <rect
                        key={o.id}
                        x={(o.min[0] + 32) * 5}
                        y={(o.min[2] + 34) * 5}
                        width={(o.max[0] - o.min[0]) * 5}
                        height={(o.max[2] - o.min[2]) * 5}
                        fill={
                          obstacleId === o.id
                            ? "#c0aff7"
                            : o.kind === "rack"
                              ? "#687f88"
                              : "#425763"
                        }
                        stroke="#aec5c5"
                        strokeWidth=".5"
                        onClick={() => setObstacleId(o.id)}
                      >
                        <title>{o.label}</title>
                      </rect>
                    ))}
                    {working.devices.map((d) => (
                      <circle
                        key={d.id}
                        cx={(d.position[0] + 32) * 5}
                        cy={(d.position[2] + 34) * 5}
                        r="2"
                        fill="#bdf1d7"
                        pointerEvents="none"
                      />
                    ))}
                  </svg>
                  <label>
                    Structure
                    <select
                      value={obstacleId}
                      onChange={(e) => setObstacleId(e.target.value)}
                    >
                      <option value="">Select a structure…</option>
                      {working.obstacles.map((o) => (
                        <option key={o.id} value={o.id}>
                          {o.label}
                        </option>
                      ))}
                    </select>
                  </label>
                  {obstacle && (
                    <fieldset className="lab-fields" disabled={!canEdit}>
                      <label>
                        Structure name
                        <input
                          value={obstacle.label}
                          onChange={(e) =>
                            setDefinition((d) =>
                              d
                                ? {
                                    ...d,
                                    obstacles: d.obstacles.map((o) =>
                                      o.id === obstacle.id
                                        ? { ...o, label: e.target.value }
                                        : o,
                                    ),
                                  }
                                : d,
                            )
                          }
                        />
                      </label>
                      <div className="lab-input-grid">
                        {(["min", "max"] as const).flatMap((edge) =>
                          [0, 1, 2].map((i) => (
                            <label key={edge + i}>
                              {edge} {["X", "Y", "Z"][i]} · m
                              <input
                                type="number"
                                step=".1"
                                value={obstacle[edge][i]}
                                onChange={(e) =>
                                  setDefinition((d) =>
                                    d
                                      ? {
                                          ...d,
                                          obstacles: d.obstacles.map((o) => {
                                            if (o.id !== obstacle.id) return o;
                                            const point = [...o[edge]] as Vec3;
                                            point[i] = Number(e.target.value);
                                            return { ...o, [edge]: point };
                                          }),
                                        }
                                      : d,
                                  )
                                }
                              />
                            </label>
                          )),
                        )}
                      </div>
                      <button
                        className="lab-text-button lab-red"
                        onClick={() => {
                          setDefinition((d) =>
                            d
                              ? {
                                  ...d,
                                  obstacles: d.obstacles.filter(
                                    (o) => o.id !== obstacle.id,
                                  ),
                                }
                              : d,
                          );
                          setObstacleId("");
                        }}
                      >
                        Remove structure
                      </button>
                    </fieldset>
                  )}
                  <button
                    className="lab-secondary lab-full"
                    disabled={!canEdit || working.obstacles.length >= 128}
                    onClick={() => {
                      const id = "barrier-" + crypto.randomUUID().slice(0, 6);
                      setDefinition((d) =>
                        d
                          ? {
                              ...d,
                              obstacles: [
                                ...d.obstacles,
                                {
                                  id,
                                  label: "Temporary barrier",
                                  kind: "freight",
                                  min: [-3, 0, 4],
                                  max: [0, 2, 6],
                                },
                              ],
                            }
                          : d,
                      );
                      setObstacleId(id);
                    }}
                  >
                    ＋ Add temporary barrier
                  </button>
                  <details>
                    <summary>Full definition / cargo editing</summary>
                    <p className="lab-muted">
                      Export, edit cargo positions, conditions or mass, then
                      import as a new sandbox.
                    </p>
                    <button
                      onClick={() => download(working.name + ".json", working)}
                    >
                      Export definition JSON
                    </button>
                  </details>
                </>
              )}
              {tab === "workflow" && workflow && (
                <>
                  <label>
                    Workflow name
                    <input
                      value={workflow.name}
                      onChange={(e) =>
                        setWorkflow({ ...workflow, name: e.target.value })
                      }
                    />
                  </label>
                  <h3>Assign bodies to roles</h3>
                  {Object.entries(workflow.actors).map(([actor, id]) => (
                    <label key={actor}>
                      {actor}
                      <select
                        value={id}
                        onChange={(e) =>
                          setWorkflow({
                            ...workflow,
                            actors: {
                              ...workflow.actors,
                              [actor]: e.target.value,
                            },
                          })
                        }
                      >
                        {working.devices.map((d) => (
                          <option key={d.id} value={d.id}>
                            {d.label} · {d.kind}
                          </option>
                        ))}
                      </select>
                    </label>
                  ))}
                  <button
                    className="lab-text-button"
                    disabled={
                      Object.keys(workflow.actors).length >= 6 ||
                      Object.keys(workflow.actors).length >=
                        working.devices.length
                    }
                    onClick={() => {
                      const next = working.devices.find(
                        (d) => !Object.values(workflow.actors).includes(d.id),
                      );
                      if (next)
                        setWorkflow({
                          ...workflow,
                          actors: {
                            ...workflow.actors,
                            ["actor_" +
                            (Object.keys(workflow.actors).length + 1)]: next.id,
                          },
                        });
                    }}
                  >
                    ＋ Bind another body
                  </button>
                  <ol className="lab-workflow-list">
                    {workflow.steps.map((s, i) => (
                      <li key={i}>
                        <span>{String(i + 1).padStart(2, "0")}</span>
                        <div>
                          <strong>{s.label ?? commandText(s.command)}</strong>
                          <small>
                            {s.actor} · {commandText(s.command)}
                            {s.dwellSeconds
                              ? " · dwell " + s.dwellSeconds + " s"
                              : ""}
                          </small>
                        </div>
                        <button
                          aria-label={"Remove workflow step " + (i + 1)}
                          onClick={() =>
                            setWorkflow({
                              ...workflow,
                              steps: workflow.steps.filter(
                                (_, index) => index !== i,
                              ),
                            })
                          }
                        >
                          ×
                        </button>
                      </li>
                    ))}
                  </ol>
                  <div className="lab-step-builder">
                    <h3>Add a workflow step</h3>
                    <div className="lab-input-grid">
                      <label>
                        Actor
                        <select
                          value={stepActor}
                          onChange={(e) => setStepActor(e.target.value)}
                        >
                          {Object.keys(workflow.actors).map((a) => (
                            <option key={a}>{a}</option>
                          ))}
                        </select>
                      </label>
                      <label>
                        Action
                        <select
                          value={stepType}
                          onChange={(e) =>
                            setStepType(e.target.value as Command["type"])
                          }
                        >
                          {[
                            "move",
                            "takeoff",
                            "look",
                            "inspect",
                            "land",
                            "preset",
                            "grasp",
                            "place",
                            "stop",
                          ].map((a) => (
                            <option key={a}>{a}</option>
                          ))}
                        </select>
                      </label>
                      {stepType === "move" && (
                        <>
                          <label>
                            Target X
                            <input
                              type="number"
                              value={x}
                              onChange={(e) => setX(e.target.value)}
                            />
                          </label>
                          <label>
                            Target Y · drone
                            <input
                              type="number"
                              value={y}
                              onChange={(e) => setY(e.target.value)}
                            />
                          </label>
                          <label>
                            Target Z
                            <input
                              type="number"
                              value={z}
                              onChange={(e) => setZ(e.target.value)}
                            />
                          </label>
                        </>
                      )}
                      {stepType === "look" && (
                        <>
                          <label>
                            Pan °
                            <input
                              type="number"
                              value={pan}
                              onChange={(e) => setPan(e.target.value)}
                            />
                          </label>
                          <label>
                            Tilt °
                            <input
                              type="number"
                              value={tilt}
                              onChange={(e) => setTilt(e.target.value)}
                            />
                          </label>
                        </>
                      )}
                      {(stepType === "inspect" || stepType === "grasp") && (
                        <label>
                          Cargo
                          <select
                            value={objectId}
                            onChange={(e) => setObjectId(e.target.value)}
                          >
                            {working.cargo.map((c) => (
                              <option key={c.id} value={c.id}>
                                {c.label}
                              </option>
                            ))}
                          </select>
                        </label>
                      )}
                      {stepType === "preset" && (
                        <label>
                          Arm pose
                          <select
                            value={preset}
                            onChange={(e) =>
                              setPreset(e.target.value as typeof preset)
                            }
                          >
                            <option>home</option>
                            <option>reach</option>
                            <option>drop</option>
                          </select>
                        </label>
                      )}
                      <label>
                        Post-action dwell · s
                        <input
                          type="number"
                          min="0"
                          max="60"
                          step=".5"
                          value={dwell}
                          onChange={(e) => setDwell(e.target.value)}
                        />
                      </label>
                    </div>
                    <button
                      className="lab-secondary lab-full"
                      disabled={!canEdit || workflow.steps.length >= 64}
                      onClick={addStep}
                    >
                      ＋ Add step
                    </button>
                  </div>
                  <div className="lab-input-grid">
                    <label>
                      Time budget · sim s
                      <input
                        type="number"
                        min="5"
                        max="300"
                        value={workflow.maxSimulatedSeconds}
                        onChange={(e) =>
                          setWorkflow({
                            ...workflow,
                            maxSimulatedSeconds: Number(e.target.value),
                          })
                        }
                      />
                    </label>
                    <label>
                      Playback
                      <select
                        value={playback}
                        onChange={(e) => setPlayback(Number(e.target.value))}
                      >
                        {[1, 2, 4, 8].map((n) => (
                          <option key={n} value={n}>
                            {n}× real time
                          </option>
                        ))}
                      </select>
                    </label>
                  </div>
                  <label className="lab-check">
                    <input
                      type="checkbox"
                      checked={workflow.stopOnError}
                      onChange={(e) =>
                        setWorkflow({
                          ...workflow,
                          stopOnError: e.target.checked,
                        })
                      }
                    />
                    Stop on first error
                  </label>
                  <label className="lab-check">
                    <input
                      type="checkbox"
                      checked={workflow.requireSafeEnd}
                      onChange={(e) =>
                        setWorkflow({
                          ...workflow,
                          requireSafeEnd: e.target.checked,
                        })
                      }
                    />
                    Require landing, empty grippers and arm home
                  </label>
                  <button
                    className="lab-primary lab-full"
                    disabled={!canEdit || !workflow.steps.length}
                    onClick={() => void start()}
                  >
                    ▶ {dirty ? "Save & run experiment" : "Run experiment"}
                  </button>
                  <p className="lab-muted">
                    Each run starts from this draft in a new isolated world.
                    Playback changes viewing speed; simulated results stay the
                    same.
                  </p>
                </>
              )}
              <div className="lab-draft-actions">
                <button
                  disabled={busy}
                  onClick={() => download(working.name + ".json", working)}
                >
                  Export JSON
                </button>
                <button
                  disabled={busy || dirty || !live}
                  onClick={() => void clone(draft.sandbox.id)}
                >
                  Clone draft
                </button>
                <button
                  className="lab-text-button lab-red"
                  disabled={busy || dirty || !live}
                  onClick={() => setAdvanced((v) => !v)}
                >
                  Delete draft
                </button>
              </div>
              {advanced && (
                <div className="lab-delete-confirm">
                  <p>Delete this draft? Existing trial reports remain.</p>
                  <button
                    className="lab-danger"
                    disabled={busy}
                    onClick={() =>
                      void perform(async () => {
                        await tool("sandbox_delete", {
                          sandboxId: draft.sandbox.id,
                        });
                        setDraft(null);
                        setDefinition(null);
                        setWorkflow(null);
                        setAdvanced(false);
                      })
                    }
                  >
                    Confirm delete draft
                  </button>
                  <button onClick={() => setAdvanced(false)}>Keep draft</button>
                </div>
              )}
            </div>
          ) : tab === "results" ? (
            <div className="lab-editor">
              {currentReport && runId ? (
                <>
                  <div className="lab-section-title">
                    <h3>Execution trace</h3>
                    <span>{currentReport.id}</span>
                  </div>
                  <p className="lab-muted">
                    Frozen inputs · {currentReport.scenarioHash.slice(0, 10)} ·{" "}
                    {currentReport.workflowHash.slice(0, 10)}
                  </p>
                  <ol className="lab-trace">
                    {currentReport.workflow.steps.map((step, i) => {
                      const result = currentReport.steps.find(
                        (s) => s.index === i,
                      );
                      return (
                        <li key={i} className={result?.status ?? "pending"}>
                          <span className="lab-trace-dot" />
                          <div>
                            <strong>
                              {step.label ?? commandText(step.command)}
                            </strong>
                            <small>
                              {step.actor} ·{" "}
                              {result ? statusLabel(result.status) : "Pending"}
                            </small>
                            {result?.error && (
                              <p>
                                {result.error.code} · {result.error.message}
                              </p>
                            )}
                            {result?.inspection && (
                              <p>{result.inspection.condition}</p>
                            )}
                          </div>
                        </li>
                      );
                    })}
                  </ol>
                  <div className="lab-section-title">
                    <h3>Through the device</h3>
                  </div>
                  <p className="lab-muted">
                    Capture the actual rendered sensor JPEG at the run's current
                    revision.
                  </p>
                  <button
                    className="lab-secondary lab-full"
                    disabled={busy || !live || !sceneSelected}
                    onClick={() =>
                      void perform(async () => {
                        const d = await tool<RunDetail>("experiment_inspect", {
                          runId,
                          imageResourceId: sceneSelected,
                        });
                        if (d.frame)
                          setFrame({
                            url:
                              "data:" +
                              d.frame.mimeType +
                              ";base64," +
                              d.frame.data,
                            revision: d.frame.revision,
                            resourceId: d.frame.resourceId,
                          });
                      })
                    }
                  >
                    Capture trial sensor frame
                  </button>
                  {frame && (
                    <figure className="lab-sensor-figure">
                      <img
                        className="lab-sensor-image"
                        src={frame.url}
                        alt="Captured trial device sensor view"
                      />
                      <figcaption>
                        {frame.resourceId} · frozen revision {frame.revision}
                      </figcaption>
                    </figure>
                  )}
                  <details>
                    <summary>Model assumptions</summary>
                    <ul>
                      {currentReport.assumptions.map((a) => (
                        <li key={a}>{a}</li>
                      ))}
                    </ul>
                  </details>
                </>
              ) : (
                <div className="lab-empty-small">
                  <h3>Your evidence starts here.</h3>
                  <p>
                    Run a workflow or open a previous trial to inspect the
                    command trace and device view.
                  </p>
                </div>
              )}
            </div>
          ) : (
            <div className="lab-empty-small">
              <h3>A place to experiment.</h3>
              <p>
                Clone the live warehouse or run the aisle-fit example to start.
              </p>
            </div>
          )}
        </section>
      </div>
      <footer className="lab-footer">
        <span>GHOST · ANY AGENT. ANY BODY.</span>
        <p>
          Simulation evidence depends on the configured model. Static
          structures, kinematic motion and sampled visibility; battery,
          moving-body interactions and hardware calibration are outside this
          model.
        </p>
        <details>
          <summary>Available through MCP</summary>
          <p>
            Clone with sandbox_create → add a candidate with sandbox_add_device
            → save a workflow with sandbox_update → execute with experiment_run
            → inspect and compare with experiment_inspect / experiment_compare.
            Export definitions and reports as JSON. Embodiment tools accept
            sandboxId on discover and possess.
          </p>
        </details>
      </footer>
    </main>
  );
}
