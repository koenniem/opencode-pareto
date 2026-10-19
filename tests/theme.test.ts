import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// Guards the palette: a colour tweak that drops text or point contrast below
// WCAG AA fails here instead of shipping invisibly.
const css = readFileSync(new URL('../src/style.css', import.meta.url), 'utf8');

const LABS = [
  'anthropic',
  'openai',
  'google',
  'xai',
  'meta',
  'deepseek',
  'alibaba',
  'zhipu',
  'moonshot',
  'xiaomi',
  'minimax',
  'longcat',
  'tencent',
  'stepfun',
  'other',
];

function themeBlock(selector: string): string {
  const start = css.indexOf(selector);
  if (start === -1) throw new Error(`theme block not found: ${selector}`);
  return css.slice(start, css.indexOf('}', start));
}

function token(block: string, name: string): string {
  const wanted = `--${name}`;
  for (const line of block.split('\n')) {
    const colon = line.indexOf(':');
    if (colon === -1) continue;
    if (line.slice(0, colon).trim() !== wanted) continue;
    const value = line
      .slice(colon + 1)
      .replace(';', '')
      .trim();
    if (/^#[0-9a-f]{6}$/i.test(value)) return value;
  }
  throw new Error(`token not found: ${name}`);
}

function luminance(hex: string): number {
  const channels = [1, 3, 5]
    .map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

const themes: Array<[string, string]> = [
  ['light', themeBlock(':root {')],
  ['dark', themeBlock(":root[data-theme='dark']")],
];

describe.each(themes)('%s theme contrast', (_name, block) => {
  const surface = token(block, 'surface');

  it('keeps body text well above AA on the card surface', () => {
    expect(contrast(token(block, 'ink'), surface)).toBeGreaterThan(7);
    expect(contrast(token(block, 'ink-soft'), surface)).toBeGreaterThan(7);
  });

  it('keeps secondary text above AA on the card surface', () => {
    expect(contrast(token(block, 'muted'), surface)).toBeGreaterThan(4.5);
  });

  it('keeps every point hue distinguishable at graphical-object contrast', () => {
    for (const lab of LABS) {
      const ratio = contrast(token(block, `lab-${lab}`), surface);
      expect(ratio, `lab-${lab} at ${ratio.toFixed(2)}:1`).toBeGreaterThanOrEqual(3);
    }
  });
});

describe('theme wiring', () => {
  it('ships a pre-paint theme script so dark mode never flashes white', () => {
    const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
    const head = html.slice(0, html.indexOf('</head>'));
    expect(head).toContain('dataset.theme');
    expect(head).toContain('prefers-color-scheme: dark');
  });
});
