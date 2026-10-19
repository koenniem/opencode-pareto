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


type TextShape = Extract<ReturnType<typeof buildScene>['shapes'][number], { kind: 'text' }>;

function textShapes(scene: ReturnType<typeof buildScene>): TextShape[] {
  return scene.shapes.filter((s): s is TextShape => s.kind === 'text');
}

function labelBox(shape: TextShape) {
  const w = shape.text.length * 6.3;
  const x = shape.anchor === 'end' ? shape.x - w : shape.anchor === 'middle' ? shape.x - w / 2 : shape.x;
  return { x, y: shape.y - 10, w, h: 13 };
}

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

  it('names every plotted point', () => {
    const labels = textShapes(buildScene(pts, OPTS)).map((s) => s.text);
    expect(labels).toContain('A');
    expect(labels).toContain('B');
  });

  it('never emits two overlapping labels', () => {
    const crowded: ChartPoint[] = Array.from({ length: 12 }, (_, i) => ({
      id: `m${i}`,
      label: `Model ${i}`,
      cost: 0.001 * (i + 1),
      score: 40 + i * 0.4,
      frontier: false,
    }));
    const labels = textShapes(buildScene(crowded, { ...OPTS, width: 700, height: 360 })).filter(
      (s) => s.cls === 'point-label',
    );
    const boxes = labels.map(labelBox);
    for (let i = 0; i < boxes.length; i += 1) {
      for (let j = i + 1; j < boxes.length; j += 1) {
        const a = boxes[i];
        const b = boxes[j];
        const overlap =
          a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
        expect(overlap, `${labels[i].text} overlaps ${labels[j].text}`).toBe(false);
      }
    }
  });

  it('drops a label it cannot place rather than drawing it over a point', () => {
    const sameSpot: ChartPoint[] = [
      { id: 'a', label: 'Alpha', cost: 0.01, score: 50, frontier: true },
      { id: 'b', label: 'Bravo', cost: 0.0100001, score: 50.0001, frontier: false },
    ];
    const labels = textShapes(buildScene(sameSpot, OPTS))
      .filter((s) => s.cls === 'point-label')
      .map((s) => s.text);
    expect(labels.length).toBeLessThanOrEqual(2);
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

describe('near-frontier band', () => {
  const frontier = [
    { id: 'cheap', label: 'Cheap', cost: 0.001, score: 48, frontier: true },
    { id: 'dear', label: 'Dear', cost: 0.05, score: 53, frontier: true },
    { id: 'near', label: 'Near', cost: 0.01, score: 47, frontier: false, near: true },
    { id: 'far', label: 'Far', cost: 0.2, score: 30, frontier: false },
  ];

  it('draws the admitted region rather than implying it through opacity', () => {
    const shapes = buildScene(frontier, { ...OPTS, tolerance: 3 }).shapes;
    expect(shapes.some((s) => s.kind === 'path' && s.cls === 'band')).toBe(true);
  });

  it('draws no band at zero tolerance', () => {
    const shapes = buildScene(frontier, { ...OPTS, tolerance: 0 }).shapes;
    expect(shapes.some((s) => s.kind === 'path' && s.cls === 'band')).toBe(false);
  });

  it('draws the band beneath the points so dots stay readable', () => {
    const shapes = buildScene(frontier, { ...OPTS, tolerance: 3 }).shapes;
    const band = shapes.findIndex((s) => s.cls === 'band');
    const firstPoint = shapes.findIndex((s) => s.kind === 'circle');
    expect(band).toBeGreaterThanOrEqual(0);
    expect(band).toBeLessThan(firstPoint);
  });

  it('draws no band when there is no frontier to hang it from', () => {
    const shapes = buildScene(
      [
        { id: 'a', label: 'A', cost: 0.001, score: 40, frontier: false },
        { id: 'b', label: 'B', cost: 0.01, score: 50, frontier: false },
      ],
      { ...OPTS, tolerance: 5 },
    ).shapes;
    expect(shapes.some((s) => s.cls === 'band')).toBe(false);
  });
});

describe('label leaders', () => {
  it('connects every placed label to its dot', () => {
    const scene = buildScene(pts, OPTS);
    const labels = textShapes(scene).filter((s) => s.cls === 'point-label');
    const leaders = scene.shapes.filter((s) => s.kind === 'line' && s.cls === 'leader');
    expect(labels.length).toBeGreaterThan(0);
    expect(leaders).toHaveLength(labels.length);
  });

  it('starts each leader outside the dot instead of through it', () => {
    const scene = buildScene(pts, OPTS);
    const dots = circles(scene);
    for (const leader of scene.shapes.filter((s) => s.kind === 'line' && s.cls === 'leader')) {
      if (leader.kind !== 'line') continue;
      const distances = dots.map((d) => Math.hypot(leader.x1 - d.cx, leader.y1 - d.cy));
      expect(Math.min(...distances)).toBeGreaterThanOrEqual(6);
    }
  });

  it('keeps leaders underneath their labels', () => {
    const scene = buildScene(pts, OPTS);
    const lastLeader = scene.shapes.map((s) => s.cls).lastIndexOf('leader');
    const firstLabel = scene.shapes.findIndex((s) => s.cls === 'point-label');
    expect(lastLeader).toBeLessThan(firstLabel);
  });
});
