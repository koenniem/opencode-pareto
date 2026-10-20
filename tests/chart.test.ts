import { describe, expect, it } from 'vitest';
import {
  buildScene,
  formatCostPerTask,
  formatCostTick,
  logTicks,
  type ChartPoint,
} from '../src/chart';
import { linearScale, logScale } from '../src/scales';

const OPTS = { width: 800, height: 400, xLabel: 'Go $/task', yLabel: 'Intelligence' };

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

describe('formatCostPerTask', () => {
  it('scales decimals with magnitude and drops redundant zeros', () => {
    expect(formatCostPerTask(1.2)).toBe('$1.20');
    expect(formatCostPerTask(0.048)).toBe('$0.048');
    expect(formatCostPerTask(0.01)).toBe('$0.01');
    expect(formatCostPerTask(0.001)).toBe('$0.001');
    expect(formatCostPerTask(3.6057)).toBe('$3.61');
  });
});

describe('formatCostTick', () => {
  it('drops redundant zeros from decade labels', () => {
    expect(formatCostTick(1)).toBe('$1');
    expect(formatCostTick(0.1)).toBe('$0.1');
    expect(formatCostTick(0.01)).toBe('$0.01');
    expect(formatCostTick(1.5)).toBe('$1.5');
  });
});

describe('cost scale', () => {
  it('spaces linear costs proportionally from zero', () => {
    const [a, b] = circles(buildScene(pts, { ...OPTS, scale: 'linear' }));
    // a is 0.001, b is 0.01. From a zero origin the offsets must have the
    // same 1:10 ratio as the costs.
    expect((b.cx - 74) / (a.cx - 74)).toBeCloseTo(10, 2);
  });

  it('labels the linear axis from zero', () => {
    const ticks = textShapes(buildScene(pts, { ...OPTS, scale: 'linear' }))
      .filter((s) => s.cls === 'tick' && s.text.startsWith('$'))
      .map((s) => s.text);
    expect(ticks).toContain('$0');
    expect(ticks).toContain('$0.01');
  });

  it('keeps the log scale as the default', () => {
    const log = circles(buildScene(pts, OPTS));
    const linear = circles(buildScene(pts, { ...OPTS, scale: 'linear' }));
    expect((log[1].cx - 74) / (log[0].cx - 74)).not.toBeCloseTo(10, 2);
    expect((linear[1].cx - 74) / (linear[0].cx - 74)).toBeCloseTo(10, 2);
  });
});

describe('preferred direction', () => {
  it('draws an up-left value arrow in the upper-left plot corner', () => {
    const arrow = buildScene(pts, OPTS).shapes.find(
      (s) => s.kind === 'path' && s.cls === 'direction-arrow',
    );
    expect(arrow).toBeDefined();
    if (!arrow || arrow.kind !== 'path') throw new Error('missing direction arrow');
    const [x0, y0, x1, y1] = (arrow.d.match(/[\d.]+/g) ?? []).slice(0, 4).map(Number);
    expect(x1).toBeLessThan(x0);
    expect(y1).toBeLessThan(y0);
    expect(x0).toBeLessThan(200);
    expect(y1).toBeLessThan(100);
  });

  it('labels the preferred direction', () => {
    const label = textShapes(buildScene(pts, OPTS)).find((s) => s.cls === 'direction-label');
    expect(label?.text.toLowerCase()).toContain('better');
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
    expect(
      buildScene(two, OPTS).shapes.filter((s) => s.kind === 'path' && s.cls === 'frontier-line'),
    ).toHaveLength(1);
    expect(buildScene([pts[1]], OPTS).shapes.filter((s) => s.kind === 'path')).toHaveLength(0);
  });

  it('names every plotted point', () => {
    const labels = textShapes(buildScene(pts, OPTS)).map((s) => s.text);
    expect(labels).toContain('A');
    expect(labels).toContain('B');
  });

  it('puts the cost per task in the native point description', () => {
    const dot = circles(buildScene(pts, OPTS)).find((c) => c.id === 'b')!;
    expect(dot.title ?? '').toContain('$0.01/task');
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

describe('score domain', () => {
  it('fits the y-axis to the data instead of always 0-100', () => {
    const scene = buildScene(
      [
        { id: 'a', label: 'A', cost: 0.001, score: 40, frontier: true },
        { id: 'b', label: 'B', cost: 0.01, score: 50, frontier: true },
      ],
      OPTS,
    );
    const yTicks = textShapes(scene)
      .filter((s) => s.cls === 'tick' && /^\d+(\.\d+)?$/.test(s.text))
      .map((s) => Number(s.text));
    expect(yTicks.length).toBeGreaterThan(2);
    expect(Math.min(...yTicks)).toBeGreaterThanOrEqual(35);
    expect(Math.max(...yTicks)).toBeLessThanOrEqual(55);
  });

  it('reports the domain it drew', () => {
    const scene = buildScene(pts, OPTS);
    expect(scene.yDomain[0]).toBeLessThan(40);
    expect(scene.yDomain[1]).toBeGreaterThan(50);
  });
});

describe('effort ladders', () => {
  const ladder: ChartPoint[] = [
    {
      id: 'g::low', group: 'g', label: 'G', effort: 'Low', effortOrder: 0,
      cost: 0.03, score: 30, frontier: false, lab: 'openai',
    },
    {
      id: 'g::max', group: 'g', label: 'G', effort: 'Max', effortOrder: 1, isDefault: true,
      cost: 0.12, score: 45, frontier: true, lab: 'openai',
    },
  ];

  it('connects the rungs in effort order, not with a vertical rail', () => {
    const rails = buildScene(ladder, OPTS).shapes.filter(
      (s) => s.kind === 'path' && s.cls.includes('ladder'),
    );
    expect(rails).toHaveLength(1);
    const rail = rails[0];
    if (rail.kind !== 'path') throw new Error('not a path');
    expect(rail.cls).toContain('lab-openai');
    const match = /M ([\d.]+) ([\d.]+) L ([\d.]+) ([\d.]+)/.exec(rail.d);
    expect(match).not.toBeNull();
    const [x1, y1, x2, y2] = match!.slice(1).map(Number);
    expect(x2).toBeGreaterThan(x1);
    expect(y2).toBeLessThan(y1);
  });

  it('labels the model once, at its best rung', () => {
    const scene = buildScene(ladder, OPTS);
    const labels = textShapes(scene).filter((s) => s.cls.includes('point-label'));
    expect(labels.map((l) => l.text)).toEqual(['G']);
    expect(labels[0].cls).toContain('lab-openai');
    const maxDot = circles(scene).find((d) => d.id === 'g::max')!;
    expect(Math.abs(labels[0].y - maxDot.cy)).toBeLessThan(30);
  });

  it('draws the default rung larger than a lower rung', () => {
    const dots = circles(buildScene(ladder, OPTS));
    const low = dots.find((d) => d.id === 'g::low')!;
    const max = dots.find((d) => d.id === 'g::max')!;
    expect(max.r).toBeGreaterThan(low.r);
  });

  it('marks non-default rungs for styling', () => {
    const low = circles(buildScene(ladder, OPTS)).find((d) => d.id === 'g::low')!;
    expect(low.cls).toContain('variant');
  });
});

describe('label budget', () => {
  it('keeps the permanent label count within the budget', () => {
    const many: ChartPoint[] = Array.from({ length: 24 }, (_, i) => ({
      id: `m${i}`,
      label: `Model ${i}`,
      cost: 0.001 * (i + 1),
      score: 20 + i,
      frontier: i % 6 === 0,
    }));
    const labels = textShapes(buildScene(many, { ...OPTS, maxLabels: 8 })).filter(
      (s) => s.cls === 'point-label',
    );
    expect(labels.length).toBeLessThanOrEqual(8);
  });
});

describe('tolerance corridor', () => {
  const corridor: ChartPoint[] = [
    { id: 'cheap', label: 'Cheap', cost: 0.001, score: 40, frontier: true },
    { id: 'dear', label: 'Dear', cost: 0.05, score: 50, frontier: true },
  ];

  it('draws a lower edge so the corridor is visible', () => {
    const shapes = buildScene(corridor, { ...OPTS, tolerance: 3 }).shapes;
    expect(shapes.some((s) => s.cls === 'band-edge')).toBe(true);
  });

  it('starts the frontier at the cheapest frontier model, not the plot edge', () => {
    const scene = buildScene(corridor, OPTS);
    const path = scene.shapes.find((s) => s.kind === 'path' && s.cls === 'frontier-line');
    if (!path || path.kind !== 'path') throw new Error('missing frontier');
    const startX = Number(/M ([\d.]+)/.exec(path.d)?.[1]);
    const cheap = circles(scene).find((c) => c.id === 'cheap')!;
    expect(startX).toBeCloseTo(cheap.cx, 1);
    expect(startX).toBeGreaterThan(74);
  });

  it('starts the corridor at the cheapest frontier model', () => {
    const scene = buildScene(corridor, { ...OPTS, tolerance: 3 });
    const band = scene.shapes.find((s) => s.kind === 'path' && s.cls === 'band');
    if (!band || band.kind !== 'path') throw new Error('missing band');
    const startX = Number(/M ([\d.]+)/.exec(band.d)?.[1]);
    const cheap = circles(scene).find((c) => c.id === 'cheap')!;
    expect(startX).toBeCloseTo(cheap.cx, 1);
  });

  it('moves the corridor edge as the tolerance changes', () => {
    const edgeAt = (tolerance: number) => {
      const shape = buildScene(corridor, { ...OPTS, tolerance }).shapes.find(
        (s) => s.cls === 'band-edge',
      );
      return shape && shape.kind === 'path' ? shape.d : '';
    };
    expect(edgeAt(2)).not.toBe('');
    expect(edgeAt(2)).not.toBe(edgeAt(10));
  });
});

describe('minor log ticks', () => {
  it('adds minor ticks between the labelled decades', () => {
    const minor = buildScene(pts, OPTS).shapes.filter((s) => s.cls === 'tick-minor');
    expect(minor.length).toBeGreaterThan(0);
  });
});
