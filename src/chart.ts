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
  title?: string;
}

export interface SceneOptions {
  width: number;
  height: number;
  xLabel: string;
  yLabel: string;
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
}

const PAD = { top: 20, right: 24, bottom: 56, left: 72 };
const SCORE_MAX = 100;

/** Rough glyph metrics for collision estimation; no text measurement needed. */
const CHAR_WIDTH = 6.3;
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

/** Prices span four orders of magnitude, so decimals follow magnitude. */
export function formatPrice(value: number): string {
  if (!Number.isFinite(value)) return '—';
  if (value >= 1) return `$${value.toFixed(2)}`;
  if (value >= 0.01) return `$${value.toFixed(3)}`;
  return `$${value.toFixed(4)}`;
}

function stepPath(ordered: Array<{ x: number; y: number }>): string {
  if (ordered.length < 2) return '';
  let d = `M ${ordered[0].x.toFixed(2)} ${ordered[0].y.toFixed(2)}`;
  for (let i = 1; i < ordered.length; i += 1) {
    const prev = ordered[i - 1];
    const next = ordered[i];
    d += ` L ${next.x.toFixed(2)} ${prev.y.toFixed(2)} L ${next.x.toFixed(2)} ${next.y.toFixed(2)}`;
  }
  return d;
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
function placeLabels(
  candidates: LabelCandidate[],
  bounds: Box,
  occupied: Box[],
): Shape[] {
  const placed: Shape[] = [];
  const taken: Box[] = [...occupied];

  for (const candidate of [...candidates].sort((a, b) => b.priority - a.priority)) {
    const width = candidate.text.length * CHAR_WIDTH;
    const offsets: Array<{ dx: number; dy: number; anchor: 'start' | 'middle' | 'end' }> = [
      { dx: 9, dy: 4, anchor: 'start' },
      { dx: 9, dy: -9, anchor: 'start' },
      { dx: -9, dy: 4, anchor: 'end' },
      { dx: -9, dy: -9, anchor: 'end' },
      { dx: 0, dy: -12, anchor: 'middle' },
      { dx: 0, dy: 16, anchor: 'middle' },
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
        box.x >= bounds.x && box.y >= bounds.y && box.x + box.w <= bounds.x + bounds.w && box.y + box.h <= bounds.y + bounds.h;
      if (!inside) continue;
      if (taken.some((other) => overlaps(box, other))) continue;

      taken.push(box);
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

  return placed;
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
    };
  }

  const costs = usable.map((p) => p.cost);
  const xDomain: [number, number] = [Math.min(...costs) / 2, Math.max(...costs) * 2];
  const x = logScale(xDomain, [PAD.left, width - PAD.right]);
  const y = linearScale([0, SCORE_MAX], [height - PAD.bottom, PAD.top]);

  const shapes: Shape[] = [];

  shapes.push({
    kind: 'line',
    x1: PAD.left,
    y1: height - PAD.bottom,
    x2: width - PAD.right,
    y2: height - PAD.bottom,
    cls: 'axis',
  });
  shapes.push({
    kind: 'line',
    x1: PAD.left,
    y1: PAD.top,
    x2: PAD.left,
    y2: height - PAD.bottom,
    cls: 'axis',
  });

  for (const value of [0, 25, 50, 75, 100]) {
    const py = y(value);
    shapes.push({ kind: 'line', x1: PAD.left, y1: py, x2: width - PAD.right, y2: py, cls: 'grid' });
    shapes.push({
      kind: 'text',
      x: PAD.left - 10,
      y: py + 4,
      text: String(value),
      cls: 'tick',
      anchor: 'end',
    });
  }

  for (const value of logTicks(xDomain[0], xDomain[1])) {
    const px = x(value);
    shapes.push({ kind: 'line', x1: px, y1: PAD.top, x2: px, y2: height - PAD.bottom, cls: 'grid' });
    shapes.push({
      kind: 'text',
      x: px,
      y: height - PAD.bottom + 20,
      text: formatPrice(value),
      cls: 'tick',
      anchor: 'middle',
    });
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

  const occupied: Box[] = [];

  for (const point of usable) {
    const cx = x(point.cost);
    const cy = y(Math.min(point.score, SCORE_MAX));
    const classes = ['point'];
    if (point.frontier) classes.push('frontier');
    else if (point.near) classes.push('near');
    if (point.lab) classes.push(`lab-${point.lab}`);

    shapes.push({
      kind: 'circle',
      cx,
      cy,
      r: point.frontier ? 6 : point.near ? 5 : 4,
      cls: classes.join(' '),
      id: point.id,
      title: point.title ?? `${point.label}: ${formatPrice(point.cost)}/1M · score ${point.score}`,
    });

    occupied.push({ x: cx - 7, y: cy - 7, w: 14, h: 14 });
  }

  const frontier = usable
    .filter((p) => p.frontier)
    .sort((a, b) => a.cost - b.cost)
    .map((p) => ({ x: x(p.cost), y: y(Math.min(p.score, SCORE_MAX)) }));

  if (frontier.length >= 2) {
    shapes.push({ kind: 'path', d: stepPath(frontier), cls: 'frontier' });
  }

  const labels = placeLabels(
    usable.map((point) => ({
      text: point.label,
      x: x(point.cost),
      y: y(Math.min(point.score, SCORE_MAX)),
      priority: (point.frontier ? 1000 : point.near ? 500 : 0) + point.score,
    })),
    { x: PAD.left, y: PAD.top, w: width - PAD.left - PAD.right, h: height - PAD.top - PAD.bottom },
    occupied,
  );

  return { width, height, shapes: [...shapes, ...labels], empty: null };
}
