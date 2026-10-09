/** ISO 6346 container number check digit (computed from the first 10 characters). */
export function iso6346CheckDigit(first10: string): number | null {
  if (!/^[A-Z]{4}\d{6}$/.test(first10)) return null;
  const letterValue: Record<string, number> = {};
  let n = 10;
  for (const ch of 'ABCDEFGHIJKLMNOPQRSTUVWXYZ') {
    if (n % 11 === 0) n++; // values that are multiples of 11 are skipped
    letterValue[ch] = n++;
  }
  let total = 0;
  for (let i = 0; i < 10; i++) {
    const ch = first10[i];
    const v = /\d/.test(ch) ? Number(ch) : letterValue[ch];
    total += v * 2 ** i;
  }
  return (total % 11) % 10;
}

export function normalizeContainer(raw: string | null | undefined): string | null {
  const s = (raw ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  return s || null;
}

export interface ContainerCheck {
  value: string;
  wellFormed: boolean;
  checkDigitOk: boolean;
  expectedDigit: number | null;
}

export function checkContainer(raw: string | null | undefined): ContainerCheck | null {
  const v = normalizeContainer(raw);
  if (!v) return null;
  const wellFormed = /^[A-Z]{4}\d{7}$/.test(v);
  if (!wellFormed) return { value: v, wellFormed: false, checkDigitOk: false, expectedDigit: null };
  const expected = iso6346CheckDigit(v.slice(0, 10));
  return { value: v, wellFormed: true, checkDigitOk: expected === Number(v[10]), expectedDigit: expected };
}
