import { describe, expect, it } from 'vitest';
import { buildScene, formatPrice, logTicks, type ChartPoint } from '../src/chart';
import { linearScale, logScale } from '../src/scales';

const OPTS = { width: 800, height: 400, xLabel: 'Effective $/1M', yLabel: 'Intelligence' };

const pts: ChartPoint[] = [
  { id: 'a', label: 'A', cost: 0.001, score: 40, frontier: false },
  { id: 'b', label: 'B', cost: 0.01, score: 50, frontier: true },
];

const circles = (scene: ReturnType<typeof buildScene>) =>
  scene.shapes.filter((s) => s.kind === 'circle') as Array<
    Extract<ReturnType<typeof buildScene>['shapes'][number], { kind: 'circle' }>
  >;

describe('logScale', () => {
  it('maps endpoints to the range endpoints', () => {
    const s = logScale([0.001, 1], [0, 100]);
    expect(s(0.001)).toBeCloseTo(0);
    expect(s(1)).toBeCloseTo(100);
  });

  it('places a decade at equal intervals', () => {
    const s = logScale([0.001, 1], [0, 100]);
    expect(s(0.01)).toBeCloseTo(33.333, 3);
    expect(s(0.1)).toBeCloseTo(66.667, 3);
  });
});

describe('linearScale', () => {
  it('maps linearly', () => {
    const s = linearScale([0, 100], [400, 0]);
    expect(s(0)).toBe(400);
    expect(s(100)).toBe(0);
    expect(s(50)).toBe(200);
  });
});

describe('logTicks', () => {
  it('emits decade ticks inside the domain', () => {
    expect(logTicks(0.0005, 0.4)).toEqual([0.001, 0.01, 0.1]);
  });

  it('returns empty when no decade falls inside', () => {
    expect(logTicks(0.011, 0.09)).toEqual([]);
  });
});

describe('formatPrice', () => {
  it('scales decimals with magnitude', () => {
    expect(formatPrice(1.2)).toBe('$1.20');
    expect(formatPrice(0.048)).toBe('$0.048');
    expect(formatPrice(0.001)).toBe('$0.0010');
  });
});

describe('buildScene', () => {
  it('builds one circle per point', () => {
    expect(circles(buildScene(pts, OPTS))).toHaveLength(2);
  });

  it('maps cost logarithmically, so dearer is further right', () => {
    const [a, b] = circles(buildScene(pts, OPTS));
    expect(b.cx).toBeGreaterThan(a.cx);
  });

  it('maps a higher score higher up', () => {
    const [a, b] = circles(buildScene(pts, OPTS));
    expect(b.cy).toBeLessThan(a.cy);
  });

  it('draws a frontier path only when at least two points are on it', () => {
    const two = [
      { ...pts[0], frontier: true },
      { ...pts[1], frontier: true },
    ];
    expect(buildScene(two, OPTS).shapes.filter((s) => s.kind === 'path')).toHaveLength(1);
    expect(buildScene([pts[1]], OPTS).shapes.filter((s) => s.kind === 'path')).toHaveLength(0);
  });

  it('labels frontier points and only frontier points', () => {
    const labels = buildScene(pts, OPTS)
      .shapes.filter((s) => s.kind === 'text')
      .map((s) => (s as Extract<ReturnType<typeof buildScene>['shapes'][number], { kind: 'text' }>).text);
    expect(labels).toContain('B');
    expect(labels).not.toContain('A');
  });

  it('returns an empty state instead of NaN for no points', () => {
    const scene = buildScene([], OPTS);
    expect(scene.empty).toBeTruthy();
    expect(scene.shapes.some((s) => s.kind === 'circle')).toBe(false);
  });

  it('returns an empty state for a single point', () => {
    expect(buildScene([pts[1]], OPTS).empty).toBeTruthy();
  });

  it('emits no NaN coordinates for pathological costs', () => {
    const weird: ChartPoint[] = [
      { id: 'x', label: 'X', cost: 1e-12, score: 1, frontier: false },
      { id: 'y', label: 'Y', cost: 1e12, score: 99, frontier: false },
    ];
    for (const shape of buildScene(weird, OPTS).shapes) {
      if (shape.kind === 'circle') {
        expect(Number.isFinite(shape.cx)).toBe(true);
        expect(Number.isFinite(shape.cy)).toBe(true);
      }
    }
  });

  it('keeps every circle inside the drawing area', () => {
    for (const c of circles(buildScene(pts, OPTS))) {
      expect(c.cx).toBeGreaterThanOrEqual(0);
      expect(c.cx).toBeLessThanOrEqual(OPTS.width);
      expect(c.cy).toBeGreaterThanOrEqual(0);
      expect(c.cy).toBeLessThanOrEqual(OPTS.height);
    }
  });
});
