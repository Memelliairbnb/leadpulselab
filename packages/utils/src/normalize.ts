export function normalizeName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z\s]/g, '')
    .trim()
    .replace(/\s+/g, ' ');
}

export function normalizeLocation(text: string | null): {
  city: string | null;
  state: string | null;
  country: string;
} {
  if (!text) return { city: null, state: null, country: 'US' };

  const cleaned = text.trim();

  // Common US state abbreviations
  const stateMatch = cleaned.match(
    /\b(AL|AK|AZ|AR|CA|CO|CT|DE|FL|GA|HI|ID|IL|IN|IA|KS|KY|LA|ME|MD|MA|MI|MN|MS|MO|MT|NE|NV|NH|NJ|NM|NY|NC|ND|OH|OK|OR|PA|RI|SC|SD|TN|TX|UT|VT|VA|WA|WV|WI|WY)\b/i,
  );

  const parts = cleaned.split(/[,\s]+/).filter(Boolean);

  if (parts.length >= 2 && stateMatch) {
    const stateIndex = parts.findIndex(
      (p) => p.toUpperCase() === stateMatch[1].toUpperCase(),
    );
    const city = parts.slice(0, stateIndex).join(' ') || null;
    return { city, state: stateMatch[1].toUpperCase(), country: 'US' };
  }

  return { city: cleaned, state: null, country: 'US' };
}
