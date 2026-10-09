const MAP: Record<string, string> = {
  VIETNAM: 'VN', 'VIET NAM': 'VN', BANGLADESH: 'BD', CHINA: 'CN', INDIA: 'IN', INDONESIA: 'ID', CAMBODIA: 'KH',
  THAILAND: 'TH', TURKEY: 'TR', TURKIYE: 'TR', PAKISTAN: 'PK', 'SRI LANKA': 'LK', MEXICO: 'MX', 'HONG KONG': 'HK',
  TAIWAN: 'TW', 'SOUTH KOREA': 'KR', KOREA: 'KR', JAPAN: 'JP', ITALY: 'IT', PORTUGAL: 'PT', 'UNITED STATES': 'US',
  USA: 'US', MALAYSIA: 'MY', PHILIPPINES: 'PH', MYANMAR: 'MM', EGYPT: 'EG', HONDURAS: 'HN', GUATEMALA: 'GT',
  'EL SALVADOR': 'SV', JORDAN: 'JO', NEPAL: 'NP', LAOS: 'LA', GERMANY: 'DE', FRANCE: 'FR', SPAIN: 'ES',
  'UNITED KINGDOM': 'GB', CANADA: 'CA', NICARAGUA: 'NI', HAITI: 'HT', PERU: 'PE', COLOMBIA: 'CO',
};

/** Country name or ISO-2 code -> ISO-2, or null if unknown. */
export function toIso2(raw: string | null | undefined): string | null {
  const s = (raw ?? '').trim().toUpperCase().replace(/^MADE IN\s+/, '').replace(/[().]/g, '');
  if (!s) return null;
  if (/^[A-Z]{2}$/.test(s)) return s;
  return MAP[s] ?? null;
}
