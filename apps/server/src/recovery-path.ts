import { blockingObstacle, type Obstacle, type Vec3 } from "@ghost/shared";

// Bounded aisle routing for the material handler only; ordinary body moves stay explicit.
export function recoveryPath(
  from: Vec3,
  to: Vec3,
  obstacles: Obstacle[],
): Vec3[] | null {
  const clearance: Vec3 = [0.9, 1.05, 0.9];
  const clear = (a: Vec3, b: Vec3) =>
    !blockingObstacle(a, b, clearance, obstacles);
  if (clear(from, to)) return [to];
  const key = (x: number, z: number) => `${x},${z}`;
  const point = (k: string): Vec3 => {
    const [x, z] = k.split(",").map(Number);
    return [x! / 2, from[1], z! / 2];
  };
  const start = key(Math.round(from[0] * 2), Math.round(from[2] * 2));
  const goal = key(Math.round(to[0] * 2), Math.round(to[2] * 2));
  if (!clear(from, point(start)) || !clear(point(goal), to)) return null;
  const open = new Set([start]),
    scores = new Map([[start, 0]]),
    previous = new Map<string, string>();
  const heuristic = (k: string) => {
    const p = point(k);
    return Math.abs(p[0] - to[0]) + Math.abs(p[2] - to[2]);
  };
  let budget = 14000;
  while (open.size && budget-- > 0) {
    let current = "",
      best = Infinity;
    for (const k of open) {
      const f = scores.get(k)! + heuristic(k);
      if (f < best) {
        best = f;
        current = k;
      }
    }
    if (current === goal) {
      const route = [to];
      let k: string | undefined = current;
      while (k) {
        route.unshift(point(k));
        k = previous.get(k);
      }
      // Collapse collinear/visible cells to smooth, collision-checked aisle legs.
      const result: Vec3[] = [];
      let origin = from,
        index = 0;
      while (index < route.length) {
        let next = index;
        while (next + 1 < route.length && clear(origin, route[next + 1]!))
          next++;
        result.push(route[next]!);
        origin = route[next]!;
        index = next + 1;
      }
      return result.filter(
        (p, i) =>
          Math.hypot(
            p[0] - (i ? result[i - 1]![0] : from[0]),
            p[2] - (i ? result[i - 1]![2] : from[2]),
          ) > 0.01,
      );
    }
    open.delete(current);
    const p = point(current),
      [gx, gz] = current.split(",").map(Number);
    for (const [dx, dz] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ]) {
      const x = gx! + dx!,
        z = gz! + dz!;
      if (x < -60 || x > 60 || z < -64 || z > 16) continue;
      const k = key(x, z),
        cost = scores.get(current)! + 0.5;
      if (cost >= (scores.get(k) ?? Infinity) || !clear(p, point(k))) continue;
      previous.set(k, current);
      scores.set(k, cost);
      open.add(k);
    }
  }
  return null;
}
