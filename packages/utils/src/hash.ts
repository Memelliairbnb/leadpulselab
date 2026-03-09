import { createHash } from 'crypto';

export function normalizeText(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, '')
    .trim()
    .replace(/\s+/g, ' ');
}

export function hashText(text: string): string {
  return createHash('sha256').update(normalizeText(text)).digest('hex');
}

export function hashRaw(data: string): string {
  return createHash('sha256').update(data).digest('hex');
}
