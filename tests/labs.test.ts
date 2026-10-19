import { readFileSync } from 'node:fs';
import { parse as parseYaml } from 'yaml';
import { describe, expect, it } from 'vitest';
import { LAB_BY_GO_ID, LAB_NAMES, labClass, labOf } from '../src/labs';
import type { RosterEntry } from '../src/types';

const roster = parseYaml(
  readFileSync(new URL('../data/roster.yaml', import.meta.url), 'utf8'),
) as RosterEntry[];

describe('labs', () => {
  it('assigns a lab to every model in the roster', () => {
    const missing = roster.filter((entry) => !(entry.goId in LAB_BY_GO_ID));
    expect(missing.map((entry) => entry.goId)).toEqual([]);
  });

  it('assigns no lab to a model that is not in the roster', () => {
    const known = new Set(roster.map((entry) => entry.goId));
    expect(Object.keys(LAB_BY_GO_ID).filter((id) => !known.has(id))).toEqual([]);
  });

  it('only uses declared labs', () => {
    for (const lab of Object.values(LAB_BY_GO_ID)) {
      expect(Object.keys(LAB_NAMES)).toContain(lab);
    }
  });

  it('falls back to other rather than throwing', () => {
    expect(labOf('does-not-exist')).toBe('other');
    expect(labClass('does-not-exist')).toBe('lab-other');
  });
});
