import type { SourceAdapter } from '@alh/types';

const adapters = new Map<string, SourceAdapter>();

export function registerAdapter(adapter: SourceAdapter) {
  adapters.set(adapter.name, adapter);
}

export function getAdapter(name: string): SourceAdapter | undefined {
  return adapters.get(name);
}

export function getAllAdapters(): SourceAdapter[] {
  return Array.from(adapters.values());
}
