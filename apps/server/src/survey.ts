import {
  SURVEY_GRID,
  surveyCell,
  telemetryVisible,
  STATIC_OBSTACLES,
  containsPoint,
} from "@ghost/shared";
import type {
  Body,
  SceneObject,
  Survey,
  SurveyCargo,
  Vec3,
} from "@ghost/shared";

const checkpoints = Array.from(
  { length: SURVEY_GRID.rows * SURVEY_GRID.columns },
  (_, index) => {
    const point = surveyCell(
      index % SURVEY_GRID.columns,
      Math.floor(index / SURVEY_GRID.columns),
    ).center;
    return {
      index,
      point,
      blocked: STATIC_OBSTACLES.some((obstacle) =>
        containsPoint(obstacle, point),
      ),
    };
  },
);
const blockedCount = checkpoints.filter((point) => point.blocked).length;
// Shared observation history, never a copy of the spectator's object registry.
export class SurveyTracker {
  private covered = new Set<number>();
  private cargo = new Map<string, SurveyCargo>();
  private lastObservedAt: number | null = null;

  record(body: Body, objects: SceneObject[], at: number, creditCells = true) {
    let changed = false;
    for (const object of objects) {
      const previous = this.cargo.get(object.id);
      const next: SurveyCargo = {
        id: object.id,
        label: object.label,
        position: [...object.position],
        lastSeenAt: at,
        inspectedBy: previous?.inspectedBy ?? [],
        ...(previous?.condition ? { condition: previous.condition } : {}),
      };
      if (
        !previous ||
        previous.lastSeenAt !== at ||
        previous.position.some((v, i) => v !== next.position[i])
      ) {
        this.cargo.set(object.id, next);
        changed = true;
      }
    }
    // Moving observations still return live objects, but never credit a swept path.
    if (creditCells && body.action?.status !== "running") {
      for (const checkpoint of checkpoints) {
        if (
          !checkpoint.blocked &&
          !this.covered.has(checkpoint.index) &&
          telemetryVisible(body, checkpoint.point)
        ) {
          this.covered.add(checkpoint.index);
          changed = true;
        }
      }
    }
    if (this.lastObservedAt !== at) changed = true;
    this.lastObservedAt = at;
    return changed;
  }
  inspect(body: Body, object: SceneObject, at: number) {
    this.record(body, [object], at, false);
    const cargo = this.cargo.get(object.id)!;
    cargo.condition = object.condition;
    if (!cargo.inspectedBy.includes(body.id)) cargo.inspectedBy.push(body.id);
    cargo.lastSeenAt = at;
    this.lastObservedAt = at;
  }
  snapshot(): Survey {
    return structuredClone({
      grid: SURVEY_GRID,
      rows: Array.from({ length: SURVEY_GRID.rows }, (_, row) =>
        Array.from({ length: SURVEY_GRID.columns }, (_, column) =>
          checkpoints[row * SURVEY_GRID.columns + column]!.blocked
            ? "x"
            : this.covered.has(row * SURVEY_GRID.columns + column)
              ? "1"
              : "0",
        ).join(""),
      ),
      coveredCells: this.covered.size,
      totalCells: SURVEY_GRID.columns * SURVEY_GRID.rows - blockedCount,
      blockedCells: blockedCount,
      coverageModel: "visible-floor-checkpoints" as const,
      knownCargo: [...this.cargo.values()],
      lastObservedAt: this.lastObservedAt,
    });
  }
}
