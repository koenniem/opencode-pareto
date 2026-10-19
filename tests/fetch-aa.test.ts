import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { fetchAA, parseAAResponse, trimToRoster } from '../scripts/fetch-aa';

const fixture = JSON.parse(
  readFileSync(new URL('./fixtures/aa-free.sample.json', import.meta.url), 'utf8'),
);

describe('parseAAResponse', () => {
  it('reads scores and slug from the response', () => {
    const snap = parseAAResponse(fixture);
    expect(snap.models[0].slug).toBe('fixture-model-a');
    expect(snap.models[0].scores.artificial_analysis_intelligence_index).toBe(24.5);
    expect(snap.models[0].scores.artificial_analysis_coding_index).toBe(18.5);
  });

  it('keeps null scores as null, never zero', () => {
    const snap = parseAAResponse(fixture);
    expect(snap.models[1].scores.artificial_analysis_coding_index).toBeNull();
  });

  it('captures the index version', () => {
    expect(parseAAResponse(fixture).intelligenceIndexVersion).toBe('4.1');
  });

  it('records the AA display name so the site can show which variant was scored', () => {
    expect(parseAAResponse(fixture).models[0].name).toBe('fixture-model-a (high)');
  });

  it('throws on a malformed body', () => {
    expect(() => parseAAResponse({ data: 'nope' })).toThrow();
    expect(() => parseAAResponse(null)).toThrow();
  });

  it('tolerates a missing index version', () => {
    const { intelligence_index_version: _, ...rest } = fixture;
    expect(parseAAResponse(rest).intelligenceIndexVersion).toBeNull();
  });
});

describe('trimToRoster', () => {
  it('keeps only the slugs the roster references', () => {
    const snap = parseAAResponse(fixture);
    expect(trimToRoster(snap, ['fixture-model-b']).models.map((m) => m.slug)).toEqual([
      'fixture-model-b',
    ]);
  });

  it('drops everything when the roster references nothing', () => {
    expect(trimToRoster(parseAAResponse(fixture), []).models).toEqual([]);
  });
});

describe('fetchAA', () => {
  it('follows pagination while has_more is true', async () => {
    const page1 = {
      ...fixture,
      pagination: { page: 1, page_size: 1, total_pages: 2, has_more: true },
      data: [fixture.data[0]],
    };
    const page2 = {
      ...fixture,
      pagination: { page: 2, page_size: 1, total_pages: 2, has_more: false },
      data: [fixture.data[1]],
    };

    const requested: string[] = [];
    const fakeFetch = async (url: string) => {
      requested.push(url);
      return {
        ok: true,
        status: 200,
        json: async () => (url.includes('page=2') ? page2 : page1),
      };
    };

    const snap = await fetchAA('test-key', fakeFetch as unknown as typeof fetch);
    expect(snap.models.map((m) => m.slug)).toEqual(['fixture-model-a', 'fixture-model-b']);
    expect(requested).toHaveLength(2);
  });

  it('sends the key in the x-api-key header', async () => {
    let seen: HeadersInit | undefined;
    const fakeFetch = async (_url: string, init?: RequestInit) => {
      seen = init?.headers;
      return { ok: true, status: 200, json: async () => fixture };
    };

    await fetchAA('secret-key', fakeFetch as unknown as typeof fetch);
    expect(JSON.stringify(seen)).toContain('secret-key');
  });

  it('throws with the status when AA rejects the key', async () => {
    const fakeFetch = async () => ({ ok: false, status: 401, json: async () => ({}) });
    await expect(fetchAA('bad', fakeFetch as unknown as typeof fetch)).rejects.toThrow('401');
  });

  it('stops after a sane page cap rather than looping forever', async () => {
    const looping = { ...fixture, pagination: { page: 1, page_size: 1, total_pages: 1, has_more: true } };
    const fakeFetch = async () => ({ ok: true, status: 200, json: async () => looping });
    await expect(fetchAA('k', fakeFetch as unknown as typeof fetch)).rejects.toThrow();
  });
});
