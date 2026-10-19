/** Linear mapping from a data domain to a pixel range. */
export function linearScale(
  domain: [number, number],
  range: [number, number],
): (value: number) => number {
  const [d0, d1] = domain;
  const [r0, r1] = range;
  const span = d1 - d0;
  if (span === 0) return () => r0;
  return (value) => r0 + ((value - d0) / span) * (r1 - r0);
}

/**
 * Logarithmic mapping. Domain values must be strictly positive; callers are
 * responsible for clamping, since a zero cost is not representable here.
 */
export function logScale(
  domain: [number, number],
  range: [number, number],
): (value: number) => number {
  const [d0, d1] = domain;
  const [r0, r1] = range;
  const lo = Math.log10(Math.max(d0, Number.MIN_VALUE));
  const hi = Math.log10(Math.max(d1, Number.MIN_VALUE));
  const span = hi - lo;
  if (span === 0) return () => r0;
  return (value) => {
    const v = Math.log10(Math.max(value, Number.MIN_VALUE));
    return r0 + ((v - lo) / span) * (r1 - r0);
  };
}
