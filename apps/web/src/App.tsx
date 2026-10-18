import { useCallback, useEffect, useId, useRef, useState } from "react";
import type { ReactNode } from "react";
import type {
  Body,
  Command,
  Observation,
  Possession,
  Snapshot,
  Vec3,
} from "@ghost/shared";
import { BOUNDS, CAPABILITIES, CAMERA_SENSOR, WAREHOUSE } from "@ghost/shared";
import { request, RequestError, tool } from "./api";
import { BodyIcon, Ghost, UIIcon } from "./icons";
import { BODY_COLORS, Warehouse } from "./Warehouse";
import { SensorPanel } from "./SensorPanel";
import { GimbalControls } from "./GimbalControls";
import { FleetOperations } from "./FleetOperations";
import { SurveyPanel } from "./SurveyPanel";
import type { WarehouseView } from "./Warehouse";
import { WarehouseMap, destinations } from "./WarehouseMap";

type Tokens = Record<string, { leaseId: string; expiresAt: number }>;
const readTokens = (): Tokens => {
  try {
    const value = JSON.parse(sessionStorage.getItem("ghost-leases") ?? "{}");
    if (!value || typeof value !== "object") return {};
    return Object.fromEntries(
      Object.entries(value).filter(
        (entry): entry is [string, { leaseId: string; expiresAt: number }] => {
          const token = entry[1] as {
            leaseId?: unknown;
            expiresAt?: unknown;
          } | null;
          return (
            !!token &&
            typeof token.leaseId === "string" &&
            typeof token.expiresAt === "number" &&
            Number.isFinite(token.expiresAt)
          );
        },
      ),
    );
  } catch {
    return {};
  }
};
const prettyKind = {
  camera: "Fixed camera",
  rover: "Ground rover",
  arm: "Robotic arm",
  drone: "Aerial drone",
};
const bodyDetails = {
  camera: "Southwest corner · column-mounted at 10 m.",
  rover: "Intelligence on the move.",
  arm: "Turn a decision into action.",
  drone: "See the bigger picture.",
};
function Modal({
  title,
  children,
  onClose,
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useEffect(() => {
    const element = dialog.current!;
    element.showModal();
    return () => element.close();
  }, []);
  return (
    <dialog
      ref={dialog}
      aria-labelledby={titleId}
      onCancel={onClose}
      onClick={(e) => {
        if (e.target === dialog.current) onClose();
      }}
    >
      <div className="modal-content">
        <div className="section-heading">
          <h2 id={titleId}>{title}</h2>
          <button
            className="icon-button"
            aria-label="Close dialog"
            onClick={onClose}
          >
            ×
          </button>
        </div>
        {children}
      </div>
    </dialog>
  );
}
function Copy({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      className="copy"
      onClick={() => {
        void navigator.clipboard
          ?.writeText(text)
          .then(() => {
            setCopied(true);
            setTimeout(() => setCopied(false), 1800);
          })
          .catch(() => setCopied(false));
      }}
    >
      {copied ? "Copied ✓" : "Copy"}
    </button>
  );
}
export function App() {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [connection, setConnection] = useState<
    "connecting" | "live" | "disconnected"
  >("connecting");
  const [selected, setSelected] = useState("rover-01");
  const [tokens, setTokens] = useState<Tokens>(readTokens);
  const [observation, setObservation] = useState<Observation | null>(null);
  const [tab, setTab] = useState<"control" | "observe">("control");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [ttl, setTtl] = useState(60);
  const [time, setTime] = useState(Date.now());
  const [clockOffset, setClockOffset] = useState(0);
  const [navigation, setNavigation] = useState(false);
  const [placingBox, setPlacingBox] = useState(false);
  const [targetX, setTargetX] = useState("1");
  const [targetZ, setTargetZ] = useState("1.4");
  const [altitude, setAltitude] = useState("3.4");
  const [pan, setPan] = useState(String(CAMERA_SENSOR.homePan));
  const [tilt, setTilt] = useState(String(CAMERA_SENSOR.homeTilt));
  const [focus, setFocus] = useState<Vec3 | null>(null);
  const [view, setView] = useState<WarehouseView>("facility");
  const [cameraReset, setCameraReset] = useState(0);
  const [cameraMode, setCameraMode] = useState<"orbit" | "pan">("orbit");
  const [cameraZoom, setCameraZoom] = useState({ id: 0, factor: 1 });
  const [following, setFollowing] = useState(false);
  const [immersive, setImmersive] = useState(false);
  const [mapVisible, setMapVisible] = useState(true);
  const [bodyCamera, setBodyCamera] = useState(false);
  useEffect(() => {
    if (!immersive) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const exit = (event: KeyboardEvent) => {
      if (event.key === "Escape") setImmersive(false);
    };
    window.addEventListener("keydown", exit);
    return () => {
      document.body.style.overflow = previous;
      window.removeEventListener("keydown", exit);
    };
  }, [immersive]);
  const [modal, setModal] = useState<"connect" | "help" | "reset" | null>(null);
  const [privateAccess, setPrivateAccess] = useState(false);
  const [oauthEnabled, setOauthEnabled] = useState(false);
  const mcpUrl = `${window.location.origin}/mcp`;
  useEffect(() => {
    void request<{ authenticated: boolean; oauth?: boolean }>("/api/access")
      .then((value) => {
        setPrivateAccess(value.authenticated);
        setOauthEnabled(!!value.oauth);
      })
      .catch(() => {
        /* The connection indicator handles offline status. */
      });
  }, []);
  const lastSnapshot = useRef<Snapshot | null>(null);
  const instance = useRef<string | null>(null);
  const currentSelection = useRef(selected);
  currentSelection.current = selected;
  const latestTokens = useRef(tokens);
  latestTokens.current = tokens;
  const report = useCallback(
    (failure: unknown) =>
      setError(
        failure instanceof Error
          ? failure.message
          : "The command could not be completed.",
      ),
    [],
  );
  const forget = useCallback(
    (id: string) =>
      setTokens((previous) => {
        const copy = { ...previous };
        delete copy[id];
        return copy;
      }),
    [],
  );
  useEffect(() => {
    try {
      sessionStorage.setItem("ghost-leases", JSON.stringify(tokens));
    } catch {
      /* Storage may be disabled; in-memory leases still work. */
    }
  }, [tokens]);
  useEffect(() => {
    let alive = true;
    let receivedStream = false;
    const accept = (next: Snapshot) => {
      if (!alive) return;
      if (
        lastSnapshot.current?.instanceId === next.instanceId &&
        (next.revision < lastSnapshot.current.revision ||
          (next.revision === lastSnapshot.current.revision &&
            next.at < lastSnapshot.current.at))
      )
        return;
      if (instance.current && instance.current !== next.instanceId) {
        setTokens({});
        setObservation(null);
        setError(
          "The warehouse restarted. Your previous possession has ended.",
        );
      }
      instance.current = next.instanceId;
      lastSnapshot.current = next;
      setClockOffset(next.at - Date.now());
      setSnapshot(next);
      setConnection("live");
      for (const [id, token] of Object.entries(latestTokens.current)) {
        if (
          !next.bodies.find((b) => b.id === id)?.lease ||
          token.expiresAt <= next.at
        )
          forget(id);
      }
    };
    void request<Snapshot>("/api/snapshot")
      .then((next) => {
        if (!receivedStream) accept(next);
      })
      .catch(() => {
        if (alive) setConnection("disconnected");
      });
    const stream = new EventSource("/api/events");
    stream.onmessage = (event) => {
      receivedStream = true;
      try {
        accept(JSON.parse(event.data));
      } catch {
        if (alive) setConnection("disconnected");
      }
    };
    stream.onerror = () => {
      if (alive) setConnection("disconnected");
      void request("/api/access").catch(() => {});
    };
    const timer = setInterval(() => setTime(Date.now()), 250);
    return () => {
      alive = false;
      stream.close();
      clearInterval(timer);
    };
  }, [forget]);
  const body = snapshot?.bodies.find((b) => b.id === selected);
  const token = tokens[selected];
  const owns = !!token && !!body?.lease && token.expiresAt > time + clockOffset;
  const live = connection === "live";
  const running = body?.action?.status === "running";
  const canAct = live && owns && !busy && !running;
  const remaining = Math.max(
    0,
    Math.ceil(((body?.lease?.expiresAt ?? 0) - time - clockOffset) / 1000),
  );
  const completed = snapshot?.mission.filter((s) => s.complete).length ?? 0;
  useEffect(() => {
    setNavigation(false);
    setObservation(null);
  }, [selected]);
  useEffect(() => {
    if (!token || !owns || !live) {
      setObservation(null);
      return;
    }
    let active = true;
    const observe = () => {
      void tool<Observation>("observe", { leaseId: token.leaseId })
        .then((value) => {
          if (active)
            setObservation((previous) =>
              !previous || value.revision >= previous.revision
                ? value
                : previous,
            );
        })
        .catch((failure) => {
          if (
            active &&
            failure instanceof RequestError &&
            ["INVALID_LEASE", "LEASE_EXPIRED", "LEASE_RELEASED"].includes(
              failure.code,
            )
          )
            forget(selected);
        });
    };
    observe();
    const timer = setInterval(observe, 800);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [token?.leaseId, owns, live, selected, forget]);
  const demoSelection = useRef<string | null>(null);
  useEffect(() => {
    if (!snapshot?.demo.running) {
      demoSelection.current = null;
      return;
    }
    const kind = snapshot.demo.phase.startsWith("01")
      ? "camera"
      : snapshot.demo.phase.startsWith("02")
        ? "rover"
        : snapshot.demo.phase.startsWith("03")
          ? "drone"
          : "arm";
    if (demoSelection.current === kind) return;
    demoSelection.current = kind;
    setSelected(`${kind}-01`);
    setView("mission");
    const activeBody = lastSnapshot.current?.bodies.find(
      (b) => b.kind === kind,
    );
    setFocus(activeBody ? [...activeBody.position] : null);
    setFollowing(true);
  }, [snapshot?.demo.phase, snapshot?.demo.running]);
  const placeBox = (x: number, z: number) => {
    void perform(async () => {
      await tool("operations", { action: "place_box", x, z });
      setPlacingBox(false);
    });
  };
  async function perform(work: () => Promise<void>) {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await work();
    } catch (failure) {
      report(failure);
    } finally {
      setBusy(false);
    }
  }
  const act = (command: Command) => {
    if (!token) return;
    void perform(async () => {
      await tool("act", { leaseId: token.leaseId, command });
      const next = await tool<Observation>("observe", {
        leaseId: token.leaseId,
      });
      if (currentSelection.current === selected)
        setObservation((previous) =>
          !previous || next.revision >= previous.revision ? next : previous,
        );
    });
  };
  const possess = () => {
    void perform(async () => {
      for (const [id, other] of Object.entries(tokens))
        if (id !== selected) {
          try {
            await tool("release", { leaseId: other.leaseId });
          } catch (failure) {
            if (
              !(failure instanceof RequestError) ||
              !["INVALID_LEASE", "LEASE_EXPIRED", "LEASE_RELEASED"].includes(
                failure.code,
              )
            )
              throw failure;
          }
          forget(id);
        }
      const result = await tool<Possession>("possess", {
        resourceId: selected,
        ttlSeconds: ttl,
        owner: "You · browser",
      });
      setTokens((previous) => ({
        ...previous,
        [selected]: { leaseId: result.leaseId, expiresAt: result.expiresAt },
      }));
    });
  };
  const release = () => {
    if (token)
      void perform(async () => {
        await tool("release", { leaseId: token.leaseId });
        forget(selected);
        setNavigation(false);
      });
  };
  const move = (x: number, z: number) => {
    setNavigation(false);
    setTargetX(String(x));
    setTargetZ(String(z));
    act({
      type: "move",
      x,
      z,
      ...(body?.kind === "drone" ? { y: Number(altitude) } : {}),
    });
  };
  const demo = () => {
    void perform(async () => {
      await request(
        `/api/demo/${snapshot?.demo.running ? "stop" : "start"}`,
        {},
      );
      setNavigation(false);
    });
  };
  const chooseBody = (id: string) => {
    setSelected(id);
    setTab("control");
    const selectedBody = snapshot?.bodies.find((b) => b.id === id);
    setFocus(selectedBody ? [...selectedBody.position] : null);
    setFollowing(true);
    setView("mission");
  };
  return (
    <main className={`app ${immersive ? "immersive" : ""}`}>
      <header className="topbar">
        <a className="brand" href="/" aria-label="GHOST home">
          <Ghost size={29} />
          <span>
            GHOST<span className="brand-dot">®</span>
          </span>
        </a>
        <span className="brand-tagline">
          Any agent.
          <br />
          Any body.
        </span>
        <div className="topbar-divider" />
        <span className="environment-name">
          <span className="tiny-square" />
          WAREHOUSE / 01
        </span>
        <div className="topbar-actions">
          <a className="quiet lab-nav-link" href="#lab">
            Experiment lab ↗
          </a>
          <span className={`connection ${connection}`} role="status">
            <i />
            {connection === "live"
              ? "Systems live"
              : connection === "connecting"
                ? "Connecting"
                : "Disconnected"}
          </span>
          <button
            className="quiet help-button"
            onClick={() => setModal("help")}
          >
            Quick start
          </button>
          <button
            className="quiet connect-button"
            onClick={() => setModal("connect")}
          >
            <UIIcon name="connect" /> Connect an agent <UIIcon name="arrow" />
          </button>
          {privateAccess && (
            <form method="post" action="/auth/logout">
              <button className="quiet" type="submit">
                Sign out
              </button>
            </form>
          )}
        </div>
      </header>
      <section className="page-heading">
        <div>
          <div className="eyebrow">
            <span className="accent-line" />
            SIMULATED EMBODIMENT / LIVE SANDBOX
          </div>
          <h1>
            Intelligence, <span>embodied.</span>
          </h1>
          <p>
            Local autonomy handles the routine. Your ghost handles the
            exception.
          </p>
        </div>
        <div className="heading-actions">
          <button
            className="primary enter-live"
            onClick={() => {
              setImmersive(true);
              setSelected("rover-01");
              const rover = snapshot?.bodies.find((b) => b.id === "rover-01");
              setFocus(rover ? [...rover.position] : null);
              setFollowing(true);
            }}
          >
            Enter live warehouse <UIIcon name="expand" />
          </button>
          <div className="demo-caption">
            SCRIPTED WALKTHROUGH<span>Classic four-body tour</span>
          </div>
          <button
            className={`legacy-tour demo-button ${snapshot?.demo.running ? "stop-demo" : ""}`}
            disabled={!live || busy}
            onClick={demo}
          >
            {snapshot?.demo.running ? (
              <>
                <UIIcon name="stop" /> Stop demo
              </>
            ) : (
              <>
                <UIIcon name="play" /> Run guided demo
              </>
            )}
          </button>
        </div>
      </section>
      {error && (
        <div className="notice error" role="alert">
          <span>{error}</span>
          <button aria-label="Dismiss error" onClick={() => setError(null)}>
            ×
          </button>
        </div>
      )}
      {!live && (
        <div className="notice" role="status">
          {snapshot
            ? "Connection interrupted. Showing the last known state. Controls will resume after reconnection."
            : "Connecting to the warehouse authority… Start the project with npm run dev if this takes more than a moment."}
        </div>
      )}
      <FleetOperations
        snapshot={snapshot}
        disabled={!live || busy}
        placing={placingBox}
        setPlacing={setPlacingBox}
        leaseId={
          tokens[
            snapshot?.operations?.incidents.find((i) => !i.resolvedAt)
              ?.resourceId ?? ""
          ]?.leaseId
        }
        focus={(id) => {
          const b = snapshot?.bodies.find((b) => b.id === id);
          setSelected(id);
          setBodyCamera(false);
          setFocus(b ? [...b.position] : null);
          setFollowing(true);
        }}
      />
      <section className="operations" aria-label="Warehouse operations">
        <aside className="fleet panel">
          <div className="section-heading">
            <h2>Available bodies</h2>
            <span className="count">04</span>
          </div>
          <p className="section-description">Choose a host. Make it yours.</p>
          <div className="fleet-list" role="group" aria-label="Select a body">
            {snapshot?.bodies.map((item, index) => (
              <button
                key={item.id}
                className={`body-card ${selected === item.id ? "selected" : ""}`}
                style={
                  {
                    "--body-color": BODY_COLORS[item.kind],
                  } as React.CSSProperties
                }
                aria-pressed={selected === item.id}
                onClick={() => chooseBody(item.id)}
              >
                <div className="body-card-top">
                  <span className="body-symbol">
                    <BodyIcon kind={item.kind} />
                  </span>
                  <span className="body-number">0{index + 1}</span>
                </div>
                <div className="body-card-title">
                  <strong>{item.label}</strong>
                  <UIIcon name="arrow" />
                </div>
                <span className="body-kind">{prettyKind[item.kind]}</span>
                <div className={`body-status ${item.lease ? "possessed" : ""}`}>
                  <i />
                  {item.lease
                    ? item.action?.status === "running"
                      ? "In motion"
                      : "Possessed"
                    : "Available"}
                  <span>{item.lease ? "LEASED" : "READY"}</span>
                </div>
              </button>
            )) ?? <div className="fleet-skeleton">Awaiting live registry…</div>}
          </div>
          <div className="fleet-footer">
            <span className="small-ghost">
              <Ghost size={18} />
            </span>
            <p>
              The intelligence is yours.
              <br />
              <strong>The body is temporary.</strong>
            </p>
          </div>
        </aside>
        <div className="viewport panel">
          <div className="viewport-toolbar">
            <div>
              <span className="live-indicator" />
              <strong>Warehouse 01</strong>
              <span className="muted toolbar-extra">
                / Digital warehouse · simulation
              </span>
            </div>
            <div className="viewport-actions">
              <button
                className="immersive-toggle"
                aria-pressed={bodyCamera}
                onClick={() => setBodyCamera((value) => !value)}
              >
                {bodyCamera ? "Warehouse view" : "Body camera"}
              </button>
              {immersive && (
                <button
                  className="immersive-toggle"
                  disabled={!live || busy}
                  onClick={demo}
                >
                  {snapshot?.demo.running ? "Stop tour" : "Run tour"}
                </button>
              )}
              <span className="viewport-badge">
                {live ? "LIVE TWIN" : "OFFLINE"}
              </span>
              <button
                className="immersive-toggle"
                aria-label={
                  immersive ? "Exit immersive view" : "Enter immersive view"
                }
                aria-pressed={immersive}
                onClick={() => setImmersive((v) => !v)}
              >
                <UIIcon name="expand" /> {immersive ? "Exit" : "Immerse"}
              </button>
            </div>
          </div>
          <div
            className={`scene ${navigation ? "navigating" : ""}`}
            aria-label={
              bodyCamera
                ? "Live body camera. Move the possessed body using its controls or map. Choose Warehouse view to orbit, pan and zoom."
                : "Interactive 3D warehouse. Drag to orbit; choose Pan to drag the camera. Pinch, scroll, or use zoom buttons. Use the map to navigate."
            }
          >
            {immersive && (
              <FleetOperations
                compact
                snapshot={snapshot}
                disabled={!live || busy}
                placing={placingBox}
                setPlacing={setPlacingBox}
                leaseId={
                  tokens[
                    snapshot?.operations?.incidents.find((i) => !i.resolvedAt)
                      ?.resourceId ?? ""
                  ]?.leaseId
                }
                focus={(id) => {
                  const b = snapshot?.bodies.find((b) => b.id === id);
                  setSelected(id);
                  setBodyCamera(false);
                  setFocus(b ? [...b.position] : null);
                  setFollowing(true);
                }}
              />
            )}
            {snapshot ? (
              <Warehouse
                snapshot={snapshot}
                selected={selected}
                onSelect={chooseBody}
                navigate={
                  placingBox ? placeBox : navigation && canAct ? move : null
                }
                focus={focus}
                view={view}
                reset={cameraReset}
                mode={cameraMode}
                zoom={cameraZoom}
                follow={following}
                sensorId={bodyCamera ? selected : undefined}
              />
            ) : (
              <div className="scene-loading">
                <Ghost size={48} />
                <p>Preparing your next body</p>
                <span>Connecting to Warehouse 01</span>
              </div>
            )}
            <div className="scene-top">
              <span className="scene-coordinate">
                W—01{" "}
                <span>
                  {WAREHOUSE.width} × {WAREHOUSE.depth} M /{" "}
                  {WAREHOUSE.clearHeight} M HIGH BAY
                </span>
              </span>
              <button
                className="scene-button"
                onClick={() => setModal("help")}
                aria-label="Warehouse help"
              >
                ?
              </button>
            </div>
            {snapshot?.demo.running && (
              <div className="demo-phase" role="status">
                <Ghost size={20} />
                <span>{snapshot.demo.phase}</span>
              </div>
            )}
            {body && (
              <SensorPanel
                key={body.id}
                body={body}
                leaseId={owns ? tokens[body.id]?.leaseId : undefined}
                live={live}
                compact
              />
            )}
            {snapshot && mapVisible && (
              <WarehouseMap
                snapshot={snapshot}
                selected={selected}
                select={chooseBody}
                navigate={
                  placingBox
                    ? placeBox
                    : canAct &&
                        (body?.kind === "rover" ||
                          (body?.kind === "drone" && body.airborne))
                      ? move
                      : null
                }
              />
            )}
            {immersive && (
              <div
                className="immersive-fleet"
                role="group"
                aria-label="Immersive fleet"
              >
                {snapshot?.bodies.map((b) => (
                  <button
                    key={b.id}
                    aria-label={`Select ${b.label}`}
                    aria-pressed={selected === b.id}
                    onClick={() => chooseBody(b.id)}
                  >
                    <BodyIcon kind={b.kind} size={16} />
                    <span>{b.label}</span>
                  </button>
                ))}
              </div>
            )}
            {immersive && body && (
              <div className="pilot-dock">
                <div>
                  <strong>{body.label}</strong>
                  <span>
                    {body.position.map((v) => v.toFixed(1)).join(" / ")} m ·{" "}
                    {running
                      ? "IN MOTION"
                      : owns
                        ? `${remaining}s LEASE`
                        : body.lease
                          ? "LEASED"
                          : "AVAILABLE"}
                  </span>
                </div>
                <div className="pilot-actions">
                  {!owns ? (
                    <button
                      disabled={
                        !live ||
                        busy ||
                        (!!body.lease &&
                          !body.lease.owner.startsWith("Local autonomy · "))
                      }
                      onClick={possess}
                    >
                      Possess {body.label}
                    </button>
                  ) : (
                    <>
                      {(body.kind === "rover" || body.kind === "drone") && (
                        <button
                          disabled={
                            !canAct || (body.kind === "drone" && !body.airborne)
                          }
                          aria-pressed={navigation}
                          onClick={() => setNavigation((v) => !v)}
                        >
                          Set destination
                        </button>
                      )}
                      {body.kind === "drone" && (
                        <button
                          disabled={!canAct}
                          onClick={() =>
                            act({ type: body.airborne ? "land" : "takeoff" })
                          }
                        >
                          {body.airborne ? "Land" : "Take off"}
                        </button>
                      )}
                      {body.kind === "camera" && (
                        <button
                          disabled={!canAct}
                          onClick={() =>
                            act({
                              type: "look",
                              pan: CAMERA_SENSOR.homePan,
                              tilt: CAMERA_SENSOR.homeTilt,
                            })
                          }
                        >
                          Aim at cargo
                        </button>
                      )}
                      {body.kind === "arm" && (
                        <>
                          <button
                            disabled={!canAct}
                            onClick={() =>
                              act({
                                type: "preset",
                                preset:
                                  body.preset === "reach" ? "drop" : "reach",
                              })
                            }
                          >
                            {body.preset === "reach" ? "Dispatch" : "Reach"}
                          </button>
                          <button
                            disabled={!canAct}
                            onClick={() =>
                              act(
                                body.heldObjectId
                                  ? { type: "place" }
                                  : { type: "grasp", objectId: "crate-07" },
                              )
                            }
                          >
                            {body.heldObjectId ? "Place" : "Grasp"}
                          </button>
                        </>
                      )}
                      {body.kind !== "arm" && (
                        <button
                          disabled={
                            !canAct ||
                            (body.kind === "drone" && !body.airborne) ||
                            !observation?.objects.length
                          }
                          onClick={() => {
                            const closest = observation?.objects.reduce(
                              (a, b) => (a.distance < b.distance ? a : b),
                            );
                            if (closest)
                              act({ type: "inspect", objectId: closest.id });
                          }}
                        >
                          Scan nearby cargo
                        </button>
                      )}
                      <button
                        disabled={!live || busy || !running}
                        onClick={() => act({ type: "stop" })}
                      >
                        Stop
                      </button>
                      <button disabled={!live || busy} onClick={release}>
                        Release {body.label}
                      </button>
                    </>
                  )}
                </div>
                {body.kind === "drone" && (
                  <GimbalControls
                    compact
                    body={body}
                    enabled={live && owns && !busy}
                    act={act}
                  />
                )}
                {owns && observation?.inspection && (
                  <p className="pilot-result">
                    {observation.inspection.objectId} ·{" "}
                    {observation.inspection.condition}
                  </p>
                )}
              </div>
            )}
            {navigation && (
              <div className="navigation-hint" role="status">
                Tap the floor or map to set a destination{" "}
                <button onClick={() => setNavigation(false)}>Cancel</button>
              </div>
            )}
            {completed === 4 && !snapshot?.demo.running && (
              <div className="mission-success">
                <UIIcon name="check" /> Mission complete · cargo cleared for
                dispatch
              </div>
            )}
            <div className="scene-view-label">
              {bodyCamera
                ? `${body?.label.toUpperCase()} / LIVE BODY CAMERA`
                : following
                  ? `FOLLOWING / ${body?.label.toUpperCase() ?? "BODY"}`
                  : focus
                    ? "BODY FOCUS"
                    : view === "facility"
                      ? "FACILITY OVERVIEW"
                      : view === "top"
                        ? "FLOOR PLAN"
                        : "EMBODIMENT BAY"}
              <span>
                {view === "facility" && !focus
                  ? "2,816 M² · 16 STORAGE BAYS"
                  : "LIVE WAREHOUSE / 01"}
              </span>
            </div>
            <div className="scene-controls">
              <button
                title="Facility overview"
                aria-label="Reset warehouse view"
                aria-pressed={view === "facility" && !focus}
                onClick={() => {
                  setBodyCamera(false);
                  setFocus(null);
                  setView("facility");
                  setFollowing(false);
                  setCameraReset((value) => value + 1);
                }}
              >
                <UIIcon name="focus" size={18} />
              </button>
              <button
                title="Top view"
                aria-label="Toggle top view"
                onClick={() => {
                  setBodyCamera(false);
                  setFocus(null);
                  setFollowing(false);
                  setView((v) => (v === "top" ? "facility" : "top"));
                }}
              >
                <UIIcon name="top" size={18} />
              </button>
              <button
                title="Mission view"
                aria-label="Mission view"
                aria-pressed={view === "mission" && !focus}
                onClick={() => {
                  setBodyCamera(false);
                  setFocus(null);
                  setView("mission");
                  setFollowing(false);
                  setCameraReset((value) => value + 1);
                }}
              >
                <BodyIcon kind="rover" size={18} />
              </button>
              <button
                title="Follow selected body"
                aria-label="Follow selected body"
                aria-pressed={following}
                disabled={!body}
                onClick={() => {
                  setBodyCamera(false);
                  if (following) setFollowing(false);
                  else if (body) {
                    setFocus([...body.position]);
                    setFollowing(true);
                  }
                }}
              >
                <UIIcon name="target" size={18} />
              </button>
              <button
                title="Drag to orbit"
                aria-label="Orbit camera"
                aria-pressed={cameraMode === "orbit"}
                onClick={() => {
                  setBodyCamera(false);
                  setCameraMode("orbit");
                }}
              >
                <UIIcon name="reset" size={18} />
                <span className="camera-tool-label">Orbit</span>
              </button>
              <button
                title="Drag to pan"
                aria-label="Pan camera"
                aria-pressed={cameraMode === "pan"}
                onClick={() => {
                  setBodyCamera(false);
                  setCameraMode("pan");
                }}
              >
                <UIIcon name="pan" size={18} />
                <span className="camera-tool-label">Pan</span>
              </button>
              <button
                title="Zoom in"
                aria-label="Zoom in"
                disabled={bodyCamera}
                onClick={() =>
                  setCameraZoom((v) => ({ id: v.id + 1, factor: 0.75 }))
                }
              >
                <UIIcon name="zoomIn" size={18} />
              </button>
              <button
                title="Zoom out"
                aria-label="Zoom out"
                disabled={bodyCamera}
                onClick={() =>
                  setCameraZoom((v) => ({ id: v.id + 1, factor: 1.33 }))
                }
              >
                <UIIcon name="zoomOut" size={18} />
              </button>
              <button
                title="Warehouse map"
                aria-label="Toggle warehouse map"
                aria-pressed={mapVisible}
                onClick={() => setMapVisible((v) => !v)}
              >
                <UIIcon name="top" size={18} />
              </button>
            </div>
            <div className="scene-legend">
              <span>
                <i className="legend-selected" />
                Selected
              </span>
              <span>
                <i className="legend-leased" />
                Possessed
              </span>
            </div>
          </div>
          <div className="viewport-footer">
            <span>
              <span className="compass">
                N <UIIcon name="arrow" size={10} />
              </span>{" "}
              {bodyCamera ? (
                "Body-mounted optics · move using controls or map"
              ) : (
                <>
                  {cameraMode === "pan" ? "Drag to pan" : "Drag to orbit"}{" "}
                  <span className="dot-separator">·</span> Scroll / pinch to
                  zoom
                </>
              )}
            </span>
            <span>
              SIMULATION AUTHORITY{" "}
              <i className={live ? "online-dot" : "offline-dot"} />
              <span className="revision">
                R{snapshot?.revision.toString().padStart(4, "0") ?? "0000"}
              </span>
            </span>
          </div>
        </div>
        <aside className="inspector panel" aria-label="Selected body controls">
          {body ? (
            <>
              <div className="inspector-title">
                <div
                  className="inspector-icon"
                  style={{ color: BODY_COLORS[body.kind] }}
                >
                  <BodyIcon kind={body.kind} size={28} />
                </div>
                <span className="eyebrow">
                  BODY / {body.kind.toUpperCase()}
                </span>
                <h2>
                  {body.label}
                  <span className={body.lease ? "online-dot" : "neutral-dot"} />
                </h2>
                <p>{bodyDetails[body.kind]}</p>
              </div>
              <div className="inspector-tabs">
                <button
                  aria-pressed={tab === "control"}
                  onClick={() => setTab("control")}
                >
                  Control
                </button>
                <button
                  aria-pressed={tab === "observe"}
                  onClick={() => setTab("observe")}
                >
                  Observation {owns && <span className="tab-dot" />}
                </button>
              </div>
              <div className="inspector-content">
                <div className="position-label">
                  POSITION <span>METERS / XYZ</span>
                </div>
                <div className="position-values">
                  {body.position.map((value, i) => (
                    <div key={i}>
                      <span>{["X", "Y", "Z"][i]}</span>
                      <strong>{value.toFixed(2)}</strong>
                    </div>
                  ))}
                </div>
                {tab === "control" ? (
                  <>
                    <div className={`lease-box ${owns ? "owned" : ""}`}>
                      <div>
                        <span>
                          {owns
                            ? "YOU ARE IN CONTROL"
                            : body.lease
                              ? "CURRENTLY POSSESSED"
                              : "READY FOR POSSESSION"}
                        </span>
                        {body.lease ? (
                          <strong>{remaining}s</strong>
                        ) : (
                          <Ghost size={20} />
                        )}
                      </div>
                      <p>
                        {owns
                          ? "Your ghost is connected to this body."
                          : body.lease
                            ? body.lease.owner
                            : "Acquire an exclusive lease to begin."}
                      </p>
                      {body.lease && (
                        <div className="lease-progress">
                          <i
                            style={{
                              width: `${Math.min(100, (remaining / 60) * 100)}%`,
                            }}
                          />
                        </div>
                      )}
                      {!body.lease ||
                      (!owns &&
                        body.lease.owner.startsWith("Local autonomy · ")) ? (
                        <div className="possession-row">
                          <label className="sr-only" htmlFor="lease-duration">
                            Lease duration
                          </label>
                          <select
                            id="lease-duration"
                            value={ttl}
                            onChange={(e) => setTtl(Number(e.target.value))}
                          >
                            <option value={60}>60 sec</option>
                            <option value={120}>120 sec</option>
                            <option value={300}>300 sec</option>
                          </select>
                          <button
                            className="primary"
                            disabled={!live || busy || !!snapshot?.demo.running}
                            onClick={possess}
                          >
                            <Ghost size={17} />
                            {busy ? "Connecting…" : "Possess body"}
                          </button>
                        </div>
                      ) : owns ? (
                        <button
                          className="release-button"
                          disabled={!live || busy}
                          onClick={release}
                        >
                          Release body <UIIcon name="arrow" />
                        </button>
                      ) : (
                        <div className="leased-note">
                          This body will become available when released or when
                          its lease expires.
                        </div>
                      )}
                    </div>
                    <div className="command-header">
                      <h3>Body controls</h3>
                      <span>
                        {running
                          ? "IN MOTION"
                          : owns
                            ? "CONNECTED"
                            : "LEASE REQUIRED"}
                      </span>
                    </div>
                    <fieldset className="body-controls" disabled={!canAct}>
                      {(body.kind === "rover" || body.kind === "drone") && (
                        <>
                          <div
                            className="destination-grid"
                            aria-label="Warehouse destinations"
                          >
                            {destinations.map((point) => (
                              <button
                                key={point.label}
                                disabled={
                                  body.kind === "drone" && !body.airborne
                                }
                                onClick={() => move(point.x, point.z)}
                              >
                                {point.label}
                                <span>
                                  {point.x} / {point.z} m
                                </span>
                              </button>
                            ))}
                          </div>
                          <div className="coordinate-inputs">
                            <label>
                              X
                              <input
                                type="number"
                                min={BOUNDS.minX}
                                max={BOUNDS.maxX}
                                step="0.1"
                                value={targetX}
                                onChange={(e) => setTargetX(e.target.value)}
                              />
                            </label>
                            {body.kind === "drone" && (
                              <label>
                                Y
                                <input
                                  type="number"
                                  min="0.8"
                                  max={BOUNDS.maxAltitude}
                                  step="0.1"
                                  value={altitude}
                                  onChange={(e) => setAltitude(e.target.value)}
                                />
                              </label>
                            )}
                            <label>
                              Z
                              <input
                                type="number"
                                min={BOUNDS.minZ}
                                max={BOUNDS.maxZ}
                                step="0.1"
                                value={targetZ}
                                onChange={(e) => setTargetZ(e.target.value)}
                              />
                            </label>
                          </div>
                          {body.kind === "drone" && (
                            <div className="button-pair">
                              <button
                                disabled={body.airborne}
                                onClick={() => act({ type: "takeoff" })}
                              >
                                ↑ Take off
                              </button>
                              <button
                                disabled={!body.airborne}
                                onClick={() => act({ type: "land" })}
                              >
                                ↓ Land
                              </button>
                            </div>
                          )}
                          <div className="button-pair">
                            <button
                              disabled={body.kind === "drone" && !body.airborne}
                              onClick={() =>
                                move(Number(targetX), Number(targetZ))
                              }
                            >
                              Move to point <UIIcon name="arrow" />
                            </button>
                            <button
                              className={navigation ? "active" : ""}
                              disabled={body.kind === "drone" && !body.airborne}
                              onClick={() => setNavigation((v) => !v)}
                            >
                              <UIIcon name="focus" /> Pick on floor
                            </button>
                          </div>
                          <button
                            className="full-button"
                            disabled={body.kind === "drone" && !body.airborne}
                            onClick={() =>
                              act({ type: "inspect", objectId: "crate-07" })
                            }
                          >
                            Scan priority cargo <UIIcon name="target" />
                          </button>
                        </>
                      )}
                      {body.kind === "camera" && (
                        <>
                          <div className="coordinate-inputs">
                            <label>
                              Pan °
                              <input
                                type="number"
                                min="-180"
                                max="180"
                                value={pan}
                                onChange={(e) => setPan(e.target.value)}
                              />
                            </label>
                            <label>
                              Tilt °
                              <input
                                type="number"
                                min="-80"
                                max="30"
                                value={tilt}
                                onChange={(e) => setTilt(e.target.value)}
                              />
                            </label>
                          </div>
                          <button
                            className="full-button"
                            onClick={() =>
                              act({
                                type: "look",
                                pan: Number(pan),
                                tilt: Number(tilt),
                              })
                            }
                          >
                            Aim camera <UIIcon name="arrow" />
                          </button>
                          <button
                            className="full-button"
                            onClick={() =>
                              act({ type: "inspect", objectId: "crate-07" })
                            }
                          >
                            Scan priority cargo <UIIcon name="target" />
                          </button>
                          <p className="control-note">
                            {CAMERA_SENSOR.horizontalFov}° view ·{" "}
                            {CAMERA_SENSOR.range} m range · aim{" "}
                            {CAMERA_SENSOR.homePan}° / {CAMERA_SENSOR.homeTilt}°
                            toward Cargo 07.
                          </p>
                        </>
                      )}
                      {body.kind === "arm" && (
                        <>
                          <div className="preset-buttons">
                            {(["home", "reach", "drop"] as const).map(
                              (preset) => (
                                <button
                                  aria-pressed={body.preset === preset}
                                  key={preset}
                                  onClick={() =>
                                    act({ type: "preset", preset })
                                  }
                                >
                                  {preset === "drop"
                                    ? "Dispatch"
                                    : preset[0]!.toUpperCase() +
                                      preset.slice(1)}
                                </button>
                              ),
                            )}
                          </div>
                          <div className="button-pair">
                            <button
                              disabled={!!body.heldObjectId}
                              onClick={() =>
                                act({ type: "grasp", objectId: "crate-07" })
                              }
                            >
                              Grasp cargo
                            </button>
                            <button
                              disabled={!body.heldObjectId}
                              onClick={() => act({ type: "place" })}
                            >
                              Place cargo
                            </button>
                          </div>
                          <p className="control-note">
                            Reach → grasp → dispatch → place.
                            <br />
                            Gripper: {body.heldObjectId ?? "empty"}
                          </p>
                        </>
                      )}
                    </fieldset>
                    {body.kind === "drone" && (
                      <button
                        className="full-button"
                        disabled={!canAct || !body.airborne}
                        onClick={() => {
                          setAltitude("9");
                          act({
                            type: "move",
                            x: body.position[0],
                            y: 9,
                            z: body.position[2],
                          });
                        }}
                      >
                        Climb above racks · 9 m
                      </button>
                    )}
                    {body.kind === "drone" && (
                      <GimbalControls
                        body={body}
                        enabled={live && owns && !busy}
                        act={act}
                      />
                    )}
                    {running && (
                      <button
                        className="full-button stop-motion"
                        disabled={!owns || !live || busy}
                        onClick={() => act({ type: "stop" })}
                      >
                        <UIIcon name="stop" /> Stop motion
                      </button>
                    )}
                    {observation?.inspection && (
                      <div className="inspection-result">
                        <strong>
                          SCAN / {observation.inspection.objectId}
                        </strong>
                        <p>{observation.inspection.condition}</p>
                      </div>
                    )}
                    <div className="action-state">
                      <i className={running ? "online-dot" : "neutral-dot"} />
                      {body.action
                        ? `${body.action.type} · ${body.action.status}`
                        : "No commands issued"}
                    </div>
                  </>
                ) : (
                  <div className="observation-panel">
                    <SensorPanel
                      key={body.id}
                      body={body}
                      leaseId={owns ? tokens[body.id]?.leaseId : undefined}
                      live={live}
                    />
                    <div className="command-header">
                      <h3>Sensor output</h3>
                      <span>STRUCTURED</span>
                    </div>
                    {!owns ? (
                      <div className="empty-observation">
                        <BodyIcon kind={body.kind} size={34} />
                        <p>Possess {body.label} to see through its sensors.</p>
                        <button onClick={() => setTab("control")}>
                          Go to controls <UIIcon name="arrow" />
                        </button>
                      </div>
                    ) : (
                      <>
                        <div className="sensor-summary">
                          <span>VISIBLE OBJECTS</span>
                          <strong>{observation?.objects.length ?? "—"}</strong>
                        </div>
                        {observation?.objects.length === 0 && (
                          <p className="control-note">
                            No cargo in sensor range. Move closer or adjust the
                            camera.
                          </p>
                        )}
                        {observation?.objects.map((object) => (
                          <div className="observed-object" key={object.id}>
                            <strong>
                              {object.id}
                              <span>{object.distance} m</span>
                            </strong>
                            <p>{object.label}</p>
                            <small>
                              {object.position
                                .map((v) => v.toFixed(1))
                                .join(" / ")}
                            </small>
                            {object.condition && (
                              <div className="inspection-result">
                                <UIIcon name="check" /> {object.condition}
                              </div>
                            )}
                          </div>
                        ))}
                        {observation?.inspection && (
                          <div className="inspection-result">
                            <strong>
                              LAST INSPECTION /{" "}
                              {observation.inspection.objectId}
                            </strong>
                            <p>{observation.inspection.condition}</p>
                          </div>
                        )}
                        <p className="control-note">
                          Authoritative simulation data. Updates every 0.8s.
                          Analytic cargo telemetry; the camera image also
                          includes scenery occlusion.
                        </p>
                      </>
                    )}
                  </div>
                )}
              </div>
              <div className="inspector-footer">
                MCP READY
                <span>{CAPABILITIES[body.kind].length} CAPABILITIES</span>
              </div>
            </>
          ) : (
            <div className="empty-inspector">
              Waiting for the body registry…
            </div>
          )}
        </aside>
      </section>
      {snapshot && <SurveyPanel survey={snapshot.survey} />}
      <section className="bottom-grid">
        <div className="mission-panel panel">
          <div className="section-heading">
            <div>
              <span className="eyebrow">THE FIRST MISSION</span>
              <h2>One ghost. Four perspectives.</h2>
            </div>
            <span
              className={`mission-count ${completed === 4 ? "complete" : ""}`}
            >
              {completed}
              <span>/ 04</span>
            </span>
          </div>
          <p className="mission-description">
            Find, inspect, verify, and stage Cargo 07 for dispatch.
          </p>
          <div className="mission-steps">
            {snapshot?.mission.map((step, i) => (
              <button
                key={step.id}
                className={step.complete ? "complete" : ""}
                onClick={() => chooseBody(`${step.body}-01`)}
              >
                <span className="step-number">
                  {step.complete ? <UIIcon name="check" /> : `0${i + 1}`}
                </span>
                <span>
                  <strong>{["Locate", "Inspect", "Survey", "Stage"][i]}</strong>
                  <small>{step.label}</small>
                </span>
              </button>
            ))}
          </div>
          <div className="mission-bottom">
            <span>
              {snapshot?.demo.running
                ? snapshot.demo.phase
                : (snapshot?.demo.error ??
                  (completed === 4
                    ? "All checks passed. Cargo ready for dispatch."
                    : "Run the guided demo, or take control and explore."))}
            </span>
            <button
              className="text-button"
              disabled={!live || busy}
              onClick={() => setModal("reset")}
            >
              Reset warehouse <UIIcon name="reset" />
            </button>
          </div>
        </div>
        <div className="activity-panel panel">
          <div className="section-heading">
            <h2>
              Activity stream <span className="stream-label">LIVE</span>
            </h2>
            <span className="eyebrow">
              {snapshot?.activity.length ?? 0} EVENTS
            </span>
          </div>
          <div
            className="activity-list"
            role="log"
            aria-label="Warehouse activity"
          >
            {snapshot?.activity.length ? (
              snapshot.activity.slice(0, 30).map((item) => (
                <div className={`activity-item ${item.kind}`} key={item.id}>
                  <span className="activity-dot" />
                  <time>
                    {new Date(item.at).toLocaleTimeString([], {
                      hour: "2-digit",
                      minute: "2-digit",
                      second: "2-digit",
                      hour12: false,
                    })}
                  </time>
                  <p>{item.message}</p>
                </div>
              ))
            ) : (
              <div className="empty-activity">
                <span>⌁</span>
                <p>
                  Every possession leaves a trace.
                  <br />
                  <strong>Your first move starts the story.</strong>
                </p>
              </div>
            )}
          </div>
        </div>
      </section>
      <footer className="page-footer">
        <span>
          <Ghost size={15} /> GHOST{" "}
          <span className="footer-tagline">Any agent. Any body.</span>
        </span>
        <span>
          BUILT FOR AGENTS. MADE VISIBLE TO HUMANS.
          <span className="footer-simulation">
            SIMULATED ENVIRONMENT / V0.1
          </span>
        </span>
      </footer>
      {modal === "connect" && (
        <Modal title="Bring your own ghost." onClose={() => setModal(null)}>
          <p>
            Connect any MCP agent to this warehouse. Browser controls and agents
            share one authoritative world.
          </p>
          <h3>Streamable HTTP</h3>
          <p className="control-note">
            {privateAccess
              ? "Connect your MCP client with this URL and your private warehouse access key."
              : "For an agent that can reach this warehouse:"}
          </p>
          <div className="code-block">
            <code>{mcpUrl}</code>
            <Copy text={mcpUrl} />
          </div>
          {privateAccess && (
            <>
              {oauthEnabled && (
                <>
                  <h3>ChatGPT · OAuth</h3>
                  <p className="control-note">
                    Add this MCP URL to ChatGPT with OAuth authentication. Leave
                    the client ID and secret blank for automatic registration.
                    On GHOST’s consent page, enter your warehouse key and allow
                    the connection. Reconnect after eight hours or a server
                    restart.
                  </p>
                </>
              )}
              <h3>Bearer key</h3>
              <p className="control-note">
                Set the Authorization header to Bearer followed by your access
                key in a client that supports custom headers, such as Claude
                Code or Cursor.
              </p>
            </>
          )}
          {!privateAccess && (
            <>
              <h3>Stdio client configuration</h3>
              <div className="code-block">
                <pre>
                  {JSON.stringify(
                    {
                      mcpServers: {
                        ghost: {
                          command: "node",
                          args: ["/workspace/ghost/apps/server/dist/index.js"],
                        },
                      },
                    },
                    null,
                    2,
                  )}
                </pre>
                <Copy
                  text={JSON.stringify(
                    {
                      mcpServers: {
                        ghost: {
                          command: "node",
                          args: ["/workspace/ghost/apps/server/dist/index.js"],
                        },
                      },
                    },
                    null,
                    2,
                  )}
                />
              </div>
            </>
          )}
          <div className="tool-chain">
            discover <span>→</span> possess <span>→</span> observe{" "}
            <span>→</span> act <span>→</span> release
          </div>
          <p className="control-note">
            Start with discover, then possess an available body. Keep lease IDs
            private.
            {privateAccess
              ? " All connected agents share this warehouse. Restarting the server resets the world."
              : " Stdio clients must run in the same environment after npm run build."}
          </p>
        </Modal>
      )}
      {modal === "help" && (
        <Modal
          title="A body for every intention."
          onClose={() => setModal(null)}
        >
          <p>
            GHOST lets an agent temporarily inhabit a simulated machine. The
            guided mission is a scripted tour through the same live controls.
            You can also explore on your own.
          </p>
          <ol className="help-steps">
            <li>
              <strong>Select a body</strong>
              <p>
                Choose Sentinel, Scout, Atlas, or Wisp in the fleet. Selection
                lets you inspect its live state.
              </p>
            </li>
            <li>
              <strong>Possess it</strong>
              <p>
                Acquire a timed, exclusive lease. The next body you possess
                releases your previous one.
              </p>
            </li>
            <li>
              <strong>Observe and act</strong>
              <p>
                Use the controls or pick a destination on the floor. The
                Observation tab shows sensor-visible cargo and inspection
                results.
              </p>
            </li>
            <li>
              <strong>Leave it for the next ghost</strong>
              <p>
                Release your body or let its lease expire. Pending movement
                stops immediately.
              </p>
            </li>
          </ol>
          <p className="control-note">
            3D: choose Orbit or Pan, then drag. Scroll, pinch, or use + / − to
            zoom. Use Immerse for a full-window warehouse with live fleet
            controls. The map shows the whole warehouse; while controlling a
            rover or airborne drone, tap it to move. The top-view and follow
            buttons help you navigate. All motion is kinematic; there is no
            collision physics.
          </p>
          <button className="primary" onClick={() => setModal(null)}>
            Enter the warehouse <UIIcon name="arrow" />
          </button>
        </Modal>
      )}
      {modal === "reset" && (
        <Modal title="Reset the warehouse?" onClose={() => setModal(null)}>
          <p>
            This stops the demo, releases every body including agent leases, and
            returns cargo and machines to their starting positions.
          </p>
          <div className="modal-actions">
            <button onClick={() => setModal(null)}>Keep exploring</button>
            <button
              className="primary"
              disabled={busy}
              onClick={() => {
                void perform(async () => {
                  await request("/api/reset", {});
                  setTokens({});
                  setObservation(null);
                  setModal(null);
                });
              }}
            >
              Reset warehouse
            </button>
          </div>
        </Modal>
      )}
    </main>
  );
}
