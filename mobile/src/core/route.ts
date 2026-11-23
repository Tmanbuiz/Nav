/**
 * Stop ordering and timing from straight-line distances.
 *
 * These are estimates: a river crossing or one-way streets can make the real drive
 * much longer than the straight line suggests, so the app labels every time as
 * approximate and lets you reorder stops by hand.
 */

export interface Point {
  lat: number;
  lng: number;
}

/** Straight-line distance multiplied by this to approximate road distance. */
const ROAD_FACTOR = 1.4;
/** Average city driving speed in km/h, stops and lights included. */
const CITY_KMH = 40;
const BRUTE_FORCE_LIMIT = 8;

export function distanceKm(a: Point, b: Point): number {
  const R = 6371;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

export function estimateDriveMinutes(km: number): number {
  return Math.max(1, Math.ceil(((km * ROAD_FACTOR) / CITY_KMH) * 60));
}

export interface OrderOptions {
  start?: Point | null;
  end?: Point | null;
}

/**
 * Suggested visiting order as indexes into `stops`. Stops without a location keep
 * their relative order and go last. Up to 8 located stops are solved exactly.
 */
export function suggestOrder(stops: (Point | null)[], opts: OrderOptions = {}): number[] {
  const located: number[] = [];
  const unlocated: number[] = [];
  stops.forEach((p, i) => (p ? located : unlocated).push(i));

  const cost = (order: number[]) => routeCost(order.map((i) => stops[i] as Point), opts);
  const best = located.length <= BRUTE_FORCE_LIMIT ? bestPermutation(located, cost) : nearestNeighbor(located, stops, opts);
  return [...best, ...unlocated];
}

export interface ScheduleStop {
  point: Point | null;
  /** Minutes since midnight */
  windowStart: number | null;
  windowEnd: number | null;
}

export interface Schedule {
  /** When to leave the start point to reach the first stop as its window opens. */
  leaveBy: number | null;
  /** Estimated arrival at each stop, in order; null once a location or time is unknown. */
  etas: (number | null)[];
  /** True where the estimated arrival is after that stop's window closes. */
  late: boolean[];
  /** Estimated arrival at the end point (the church). */
  arriveEnd: number | null;
}

export function planSchedule(
  stops: ScheduleStop[],
  opts: OrderOptions & { dwellMinutes?: number } = {},
): Schedule {
  const dwell = opts.dwellMinutes ?? 2;
  const etas: (number | null)[] = [];

  stops.forEach((stop, i) => {
    if (i === 0) {
      etas.push(stop.windowStart);
      return;
    }
    const prev = stops[i - 1];
    const prevEta = etas[i - 1] ?? null;
    if (prevEta === null || !prev?.point || !stop.point) {
      etas.push(null);
      return;
    }
    const arrive = prevEta + dwell + estimateDriveMinutes(distanceKm(prev.point, stop.point));
    etas.push(stop.windowStart !== null ? Math.max(arrive, stop.windowStart) : arrive);
  });

  const late = stops.map((s, i) => {
    const eta = etas[i];
    return eta !== null && eta !== undefined && s.windowEnd !== null && eta > s.windowEnd;
  });

  const first = stops[0];
  const leaveBy =
    first && first.windowStart !== null && first.point && opts.start
      ? first.windowStart - estimateDriveMinutes(distanceKm(opts.start, first.point))
      : null;

  const last = stops[stops.length - 1];
  const lastEta = etas[etas.length - 1] ?? null;
  const arriveEnd =
    last && lastEta !== null && last.point && opts.end
      ? lastEta + dwell + estimateDriveMinutes(distanceKm(last.point, opts.end))
      : null;

  return { leaveBy, etas, late, arriveEnd };
}

function routeCost(points: Point[], opts: OrderOptions): number {
  let total = 0;
  let prev = opts.start ?? null;
  for (const p of points) {
    if (prev) total += distanceKm(prev, p);
    prev = p;
  }
  if (prev && opts.end && points.length) total += distanceKm(prev, opts.end);
  return total;
}

function bestPermutation(items: number[], cost: (order: number[]) => number): number[] {
  let best = [...items];
  let bestCost = cost(best);
  const current: number[] = [];
  const used = new Array<boolean>(items.length).fill(false);

  const visit = () => {
    if (current.length === items.length) {
      const c = cost(current);
      if (c < bestCost - 1e-9) {
        bestCost = c;
        best = [...current];
      }
      return;
    }
    items.forEach((item, i) => {
      if (used[i]) return;
      used[i] = true;
      current.push(item);
      visit();
      current.pop();
      used[i] = false;
    });
  };
  visit();
  return best;
}

function nearestNeighbor(items: number[], stops: (Point | null)[], opts: OrderOptions): number[] {
  const remaining = [...items];
  const order: number[] = [];
  let at = opts.start ?? (remaining.length ? (stops[remaining[0] as number] as Point) : null);
  while (remaining.length) {
    let bestIdx = 0;
    let bestDist = Infinity;
    remaining.forEach((stopIndex, i) => {
      const d = at ? distanceKm(at, stops[stopIndex] as Point) : 0;
      if (d < bestDist) {
        bestDist = d;
        bestIdx = i;
      }
    });
    const [next] = remaining.splice(bestIdx, 1);
    if (next === undefined) break;
    order.push(next);
    at = stops[next] as Point;
  }
  return order;
}

function toRad(deg: number): number {
  return (deg * Math.PI) / 180;
}
