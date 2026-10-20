import { linearScale, logScale } from './scales';

export interface ChartPoint {
  id: string;
  label: string;
  cost: number;
  score: number;
  /** On the strict Pareto frontier. */
  frontier: boolean;
  /** Inside the near-frontier band but not on the frontier. */
  near?: boolean;
  /** Lab key, used as a CSS class for colour. */
  lab?: string;
  /** Screen-reader / native title text. */
  title?: string;
  /** Model id. Points sharing it form an effort ladder. Defaults to `id`. */
  group?: string;
  /** Effort label, e.g. "Low", "Max", "Non-reasoning". */
  effort?: string;
  /** Ladder position; 0 is the least thinking. */
  effortOrder?: number;
  /** True for the model's primary rung. */
  isDefault?: boolean;
}

export interface SceneOptions {
  width: number;
  height: number;
  xLabel: string;
  yLabel: string;
  /** Score points below the best-at-price level that still count as near. */
  tolerance?: number;
  /** Maximum permanent point labels. Default 12. */
  maxLabels?: number;
}

export type Shape =
  | {
      kind: 'circle';
      cx: number;
      cy: number;
      r: number;
      cls: string;
      id: string;
      title?: string;
    }
  | { kind: 'path'; d: string; cls: string }
  | { kind: 'line'; x1: number; y1: number; x2: number; y2: number; cls: string }
  | {
      kind: 'text';
      x: number;
      y: number;
      text: string;
      cls: string;
      anchor?: 'start' | 'middle' | 'end';
    };

export interface Scene {
  width: number;
  height: number;
  shapes: Shape[];
  empty: string | null;
  /** The score range actually drawn, useful for tests and tooltips. */
  yDomain: [number, number];
}

const PAD = { top: 24, right: 26, bottom: 58, left: 74 };
const MAX_LABELS = 12;

/** Rough glyph metrics for collision estimation; no text measurement needed. */
const CHAR_WIDTH = 6.6;
const LABEL_HEIGHT = 13;

interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

function overlaps(a: Box, b: Box): boolean {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}

/** Powers of ten strictly inside the domain. */
export function logTicks(min: number, max: number): number[] {
  if (!(min > 0) || !(max > min)) return [];
  const ticks: number[] = [];
  const start = Math.ceil(Math.log10(min));
  const end = Math.floor(Math.log10(max));
  for (let exponent = start; exponent <= end; exponent += 1) {
    ticks.push(Number(`1e${exponent}`));
  }
  return ticks;
}

/** 2× and 5× multiples inside each decade, for unlabelled tick marks. */
export function logMinorTicks(min: number, max: number): number[] {
  if (!(min > 0) || !(max > min)) return [];
  const ticks: number[] = [];
  const start = Math.floor(Math.log10(min));
  const end = Math.ceil(Math.log10(max));
  for (let exponent = start; exponent <= end; exponent += 1) {
    for (const multiple of [2, 5]) {
      const value = multiple * 10 ** exponent;
      if (value > min && value < max) ticks.push(value);
    }
  }
  return ticks;
}

/** Prices span four orders of magnitude, so decimals follow magnitude. */
export function formatPrice(value: number): string {
  if (!Number.isFinite(value)) return '—';
  if (value >= 1) return `$${value.toFixed(2)}`;
  if (value >= 0.01) return `$${value.toFixed(3)}`;
  return `$${value.toFixed(4)}`;
}

/** A stable readable step: 1, 2, 2.5, 5 or 10 times a power of ten. */
function niceStep(raw: number): number {
  if (!Number.isFinite(raw) || raw <= 0) return 1;
  const exponent = Math.floor(Math.log10(raw));
  const magnitude = 10 ** exponent;
  const residual = raw / magnitude;
  const nice =
    residual < 1.5 ? 1 : residual < 2.25 ? 2 : residual < 3.5 ? 2.5 : residual < 7.5 ? 5 : 10;
  return nice * magnitude;
}

/**
 * Fit the score axis to the data.
 *
 * A fixed 0–100 axis wasted half the plot when every model scores between 19
 * and 53. The domain is padded and quantised so the points use the height and
 * the grid lines stay on round numbers.
 */
export function scoreDomain(scores: number[]): [number, number] {
  if (scores.length === 0) return [0, 100];
  const min = Math.min(...scores);
  const max = Math.max(...scores);
  const span = Math.max(max - min, 8);
  const pad = span * 0.12;
  const step = niceStep((Math.min(100, max + pad) - Math.max(0, min - pad)) / 4);
  const lo = Math.max(0, Math.floor((min - pad) / step) * step);
  const hi = Math.min(100, Math.ceil((max + pad) / step) * step);
  return hi - lo < step ? [Math.max(0, lo - step), Math.min(100, lo + step)] : [lo, hi];
}

export function niceTicks(min: number, max: number, target = 5): number[] {
  if (!(max > min)) return [];
  const step = niceStep((max - min) / Math.max(target - 1, 1));
  const ticks: number[] = [];
  const start = Math.ceil(min / step) * step;
  for (let value = start; value <= max + step * 1e-6; value += step) {
    ticks.push(Number(value.toFixed(6)));
  }
  return ticks;
}

function formatTick(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

function formatTolerance(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

function stepPath(steps: Array<{ x: number; y: number }>, plot: { left: number; right: number }): string {
  if (steps.length < 2) return '';
  let d = `M ${steps[0].x.toFixed(2)} ${steps[0].y.toFixed(2)}`;
  for (let i = 1; i < steps.length; i += 1) {
    d += ` L ${steps[i].x.toFixed(2)} ${steps[i - 1].y.toFixed(2)}`;
    d += ` L ${steps[i].x.toFixed(2)} ${steps[i].y.toFixed(2)}`;
  }
  // Extending to the right is honest: the dearest frontier model remains the
  // best available at every higher price. Extending left would claim its score
  // at prices where no frontier model exists.
  d += ` L ${plot.right.toFixed(2)} ${steps[steps.length - 1].y.toFixed(2)}`;
  return d;
}

/**
 * The tolerance corridor: everything between the frontier and `tolerance`
 * points below it.
 *
 * The fill alone was invisible at 7% opacity, so the lower boundary is a real
 * path as well. The caller styles both; geometry and visibility are separable.
 */
function bandGeometry(
  steps: Array<{ x: number; score: number }>,
  plot: { left: number; right: number },
  y: (score: number) => number,
  tolerance: number,
  floor: number,
): { fill: string; edge: string } | null {
  if (steps.length < 2 || tolerance <= 0) return null;

  const levels = [
    ...steps,
    { x: plot.right, score: steps[steps.length - 1].score },
  ];

  const corners: Array<{ x: number; score: number }> = [];
  for (let i = 0; i < levels.length - 1; i += 1) {
    corners.push({ x: levels[i].x, score: levels[i].score });
    corners.push({ x: levels[i + 1].x, score: levels[i].score });
  }

  const at = (point: { x: number; score: number }, lower: boolean) => {
    const score = lower ? point.score - tolerance : point.score;
    const py = lower ? Math.min(y(score), floor) : Math.max(y(score), PAD.top);
    return `${point.x.toFixed(2)} ${py.toFixed(2)}`;
  };

  const top = corners.map((point) => at(point, false));
  const bottom = corners.map((point) => at(point, true));

  return {
    fill: `M ${top.join(' L ')} L ${[...bottom].reverse().join(' L ')} Z`,
    edge: `M ${bottom.join(' L ')}`,
  };
}

interface LabelCandidate {
  text: string;
  x: number;
  y: number;
  priority: number;
}

/**
 * Place labels without overlapping each other, the points, or the axes.
 *
 * Greedy in priority order (frontier first, then highest score): each label
 * tries six offsets and takes the first that fits. A label with nowhere to go
 * is dropped rather than drawn on top of something else — the point keeps its
 * tooltip, so no information is lost.
 */
function placeLabels(candidates: LabelCandidate[], bounds: Box, occupied: Box[]): Shape[] {
  const placed: Shape[] = [];
  const leaders: Shape[] = [];
  const taken: Box[] = [...occupied];

  for (const candidate of [...candidates].sort((a, b) => b.priority - a.priority)) {
    const width = candidate.text.length * CHAR_WIDTH;
    const offsets: Array<{ dx: number; dy: number; anchor: 'start' | 'middle' | 'end' }> = [
      { dx: 14, dy: 4, anchor: 'start' },
      { dx: 14, dy: -10, anchor: 'start' },
      { dx: -14, dy: 4, anchor: 'end' },
      { dx: -14, dy: -10, anchor: 'end' },
      { dx: 0, dy: -16, anchor: 'middle' },
      { dx: 0, dy: 20, anchor: 'middle' },
    ];

    for (const offset of offsets) {
      const anchorX =
        offset.anchor === 'start'
          ? candidate.x + offset.dx
          : offset.anchor === 'end'
            ? candidate.x + offset.dx - width
            : candidate.x - width / 2;
      const anchorY = candidate.y + offset.dy;
      const box: Box = { x: anchorX, y: anchorY - LABEL_HEIGHT + 3, w: width, h: LABEL_HEIGHT };

      const inside =
        box.x >= bounds.x &&
        box.y >= bounds.y &&
        box.x + box.w <= bounds.x + bounds.w &&
        box.y + box.h <= bounds.y + bounds.h;
      if (!inside) continue;
      if (taken.some((other) => overlaps(box, other))) continue;

      taken.push(box);

      // A leader makes ownership explicit: with two dozen dots, "nearest dot"
      // is a guess the reader should not have to make.
      const lx = Math.max(box.x, Math.min(candidate.x, box.x + box.w));
      const ly = Math.max(box.y, Math.min(candidate.y, box.y + box.h));
      const gap = Math.hypot(lx - candidate.x, ly - candidate.y);
      if (gap > 8) {
        const ux = (lx - candidate.x) / gap;
        const uy = (ly - candidate.y) / gap;
        leaders.push({
          kind: 'line',
          x1: candidate.x + ux * 8,
          y1: candidate.y + uy * 8,
          x2: lx,
          y2: ly,
          cls: 'leader',
        });
      }

      // For anchor="end" the SVG origin is the right edge, so the emitted x is
      // the box's right edge — not its left.
      placed.push({
        kind: 'text',
        x: offset.anchor === 'end' ? anchorX + width : anchorX,
        y: anchorY,
        text: candidate.text,
        cls: 'point-label',
        anchor: offset.anchor,
      });
      break;
    }
  }

  return [...leaders, ...placed];
}

/**
 * Describe the chart as plain shapes.
 *
 * No DOM: geometry is unit-testable, and the renderer stays a thin loop. A
 * scene with fewer than two plottable points carries an `empty` message and no
 * shapes, so a degenerate dataset can never produce a chart-shaped lie.
 */
export function buildScene(points: ChartPoint[], opts: SceneOptions): Scene {
  const { width, height } = opts;
  const usable = points.filter(
    (p) => Number.isFinite(p.cost) && p.cost > 0 && Number.isFinite(p.score),
  );

  if (usable.length < 2) {
    return {
      width,
      height,
      shapes: [],
      empty:
        usable.length === 0
          ? 'No models can be plotted yet. Scores arrive with the first Artificial Analysis fetch.'
          : 'Only one model can be plotted, so there is no frontier to draw.',
      yDomain: [0, 100],
    };
  }

  const costs = usable.map((p) => p.cost);
  const logPad = 0.12;
  const xDomain: [number, number] = [
    10 ** (Math.log10(Math.min(...costs)) - logPad),
    10 ** (Math.log10(Math.max(...costs)) + logPad),
  ];
  const yDomain = scoreDomain(usable.map((p) => p.score));
  const x = logScale(xDomain, [PAD.left, width - PAD.right]);
  const y = linearScale(yDomain, [height - PAD.bottom, PAD.top]);
  const plot = { left: PAD.left, right: width - PAD.right };
  const floor = height - PAD.bottom;
  const scoreY = (score: number) => y(Math.min(Math.max(score, yDomain[0]), yDomain[1]));

  const shapes: Shape[] = [];

  shapes.push({
    kind: 'line',
    x1: PAD.left,
    y1: floor,
    x2: width - PAD.right,
    y2: floor,
    cls: 'axis',
  });
  shapes.push({
    kind: 'line',
    x1: PAD.left,
    y1: PAD.top,
    x2: PAD.left,
    y2: floor,
    cls: 'axis',
  });

  for (const value of niceTicks(yDomain[0], yDomain[1], 5)) {
    const py = y(value);
    shapes.push({ kind: 'line', x1: PAD.left, y1: py, x2: width - PAD.right, y2: py, cls: 'grid' });
    shapes.push({
      kind: 'text',
      x: PAD.left - 10,
      y: py + 4,
      text: formatTick(value),
      cls: 'tick',
      anchor: 'end',
    });
  }

  for (const value of logTicks(xDomain[0], xDomain[1])) {
    const px = x(value);
    shapes.push({ kind: 'line', x1: px, y1: PAD.top, x2: px, y2: floor, cls: 'grid' });
    shapes.push({
      kind: 'text',
      x: px,
      y: floor + 20,
      text: formatPrice(value),
      cls: 'tick',
      anchor: 'middle',
    });
  }

  for (const value of logMinorTicks(xDomain[0], xDomain[1])) {
    const px = x(value);
    shapes.push({ kind: 'line', x1: px, y1: floor, x2: px, y2: floor - 4, cls: 'tick-minor' });
  }

  shapes.push({
    kind: 'text',
    x: (PAD.left + width - PAD.right) / 2,
    y: height - 12,
    text: opts.xLabel,
    cls: 'axis-label',
    anchor: 'middle',
  });
  shapes.push({
    kind: 'text',
    x: 14,
    y: PAD.top,
    text: opts.yLabel,
    cls: 'axis-label',
    anchor: 'start',
  });

  const frontier = usable
    .filter((point) => point.frontier)
    .sort((a, b) => a.cost - b.cost)
    .map((point) => ({
      x: x(point.cost),
      y: scoreY(point.score),
      score: Math.min(Math.max(point.score, yDomain[0]), yDomain[1]),
    }));

  const band = bandGeometry(frontier, plot, scoreY, opts.tolerance ?? 0, floor);

  // Group by model so a ladder gets one rail and one permanent label.
  const groups = new Map<string, ChartPoint[]>();
  for (const point of usable) {
    const key = point.group ?? point.id;
    const group = groups.get(key);
    if (group) group.push(point);
    else groups.set(key, [point]);
  }

  const occupied: Box[] = [];
  const ladderShapes: Shape[] = [];
  for (const group of groups.values()) {
    if (group.length < 2) continue;
    const xs = group.map((point) => x(point.cost));
    const ys = group.map((point) => scoreY(point.score));
    const railX = xs.reduce((sum, value) => sum + value, 0) / xs.length;
    const top = Math.min(...ys);
    const bottom = Math.max(...ys);
    ladderShapes.push({
      kind: 'line',
      x1: railX,
      y1: top,
      x2: railX,
      y2: bottom,
      cls: 'ladder',
    });
    occupied.push({ x: railX - 2, y: top, w: 4, h: Math.max(bottom - top, 1) });
  }

  const pointShapes: Shape[] = [];
  for (const point of usable) {
    const cx = x(point.cost);
    const cy = scoreY(point.score);
    const groupSize = groups.get(point.group ?? point.id)?.length ?? 1;
    const isVariant = point.isDefault === false || (groupSize > 1 && point.isDefault !== true);
    const classes = ['point'];
    if (point.frontier) classes.push('frontier');
    else if (point.near) classes.push('near');
    if (point.lab) classes.push(`lab-${point.lab}`);
    if (isVariant) classes.push('variant');

    const r = point.frontier ? 5.5 : point.near ? 4.5 : isVariant ? 3 : 4.2;
    const effort = point.effort ? ` · ${point.effort}` : '';
    pointShapes.push({
      kind: 'circle',
      cx,
      cy,
      r,
      cls: classes.join(' '),
      id: point.id,
      title:
        point.title ??
        `${point.label}${effort}: ${formatPrice(point.cost)}/1M · score ${point.score}`,
    });
    occupied.push({ x: cx - r - 3, y: cy - r - 3, w: r * 2 + 6, h: r * 2 + 6 });
  }

  let bandLabel: Shape | null = null;
  if (band && frontier.length >= 2) {
    const last = frontier[frontier.length - 1];
    const text = `±${formatTolerance(opts.tolerance ?? 0)} pts`;
    const labelY = Math.min(scoreY(last.score - (opts.tolerance ?? 0)) + 14, floor - 2);
    const w = text.length * CHAR_WIDTH;
    const box: Box = { x: plot.right - w, y: labelY - LABEL_HEIGHT + 3, w, h: LABEL_HEIGHT };
    if (!occupied.some((other) => overlaps(box, other))) {
      occupied.push(box);
      bandLabel = {
        kind: 'text',
        x: plot.right,
        y: labelY,
        text,
        cls: 'band-label',
        anchor: 'end',
      };
    }
  }

  if (band) {
    shapes.push({ kind: 'path', d: band.fill, cls: 'band' });
    shapes.push({ kind: 'path', d: band.edge, cls: 'band-edge' });
  }
  if (bandLabel) shapes.push(bandLabel);
  shapes.push(...ladderShapes);

  if (frontier.length >= 2) {
    shapes.push({ kind: 'path', d: stepPath(frontier, plot), cls: 'frontier-line' });
  }

  shapes.push(...pointShapes);

  const anchors = new Map<string, { point: ChartPoint; priority: number }>();
  for (const point of usable) {
    const key = point.group ?? point.id;
    const priority = (point.frontier ? 1000 : point.near ? 500 : 0) + point.score;
    const current = anchors.get(key);
    if (!current || priority > current.priority) anchors.set(key, { point, priority });
  }

  const budget = Math.max(0, opts.maxLabels ?? MAX_LABELS);
  const candidates = [...anchors.values()]
    .sort((a, b) => b.priority - a.priority)
    .slice(0, budget)
    .map(({ point, priority }) => ({
      text: point.label,
      x: x(point.cost),
      y: scoreY(point.score),
      priority,
    }));

  const labels = placeLabels(
    candidates,
    { x: PAD.left, y: PAD.top, w: width - PAD.left - PAD.right, h: height - PAD.top - PAD.bottom },
    occupied,
  );

  return { width, height, shapes: [...shapes, ...labels], empty: null, yDomain };
}
