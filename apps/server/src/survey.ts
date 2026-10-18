import { SURVEY_GRID, surveyCell, telemetryVisible } from "@ghost/shared";
import type {
  Body,
  SceneObject,
  Survey,
  SurveyCargo,
  Vec3,
} from "@ghost/shared";

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
      for (let row = 0; row < SURVEY_GRID.rows; row++)
        for (let column = 0; column < SURVEY_GRID.columns; column++) {
          const index = row * SURVEY_GRID.columns + column;
          if (this.covered.has(index)) continue;
          const cell = surveyCell(column, row);
          const points: Vec3[] = [
            [cell.minX, SURVEY_GRID.floorCargoHeight, cell.minZ],
            [cell.maxX, SURVEY_GRID.floorCargoHeight, cell.minZ],
            [cell.minX, SURVEY_GRID.floorCargoHeight, cell.maxZ],
            [cell.maxX, SURVEY_GRID.floorCargoHeight, cell.maxZ],
            // Nearest point catches a camera's steepest downward angle inside a cell.
            [
              Math.max(cell.minX, Math.min(cell.maxX, body.position[0])),
              SURVEY_GRID.floorCargoHeight,
              Math.max(cell.minZ, Math.min(cell.maxZ, body.position[2])),
            ],
          ];
          if (points.every((point) => telemetryVisible(body, point))) {
            this.covered.add(index);
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
          this.covered.has(row * SURVEY_GRID.columns + column) ? "1" : "0",
        ).join(""),
      ),
      coveredCells: this.covered.size,
      totalCells: SURVEY_GRID.columns * SURVEY_GRID.rows,
      knownCargo: [...this.cargo.values()],
      lastObservedAt: this.lastObservedAt,
    });
  }
}
