/**
 * Shared utilities for the identity resolution pipeline.
 */

/**
 * Polite delay between HTTP requests to avoid rate limiting.
 * Defaults to a random interval between 1000ms and 2000ms.
 */
export async function politeDelay(minMs = 1000, maxMs = 2000): Promise<void> {
  const ms = Math.floor(Math.random() * (maxMs - minMs + 1)) + minMs;
  return new Promise((resolve) => setTimeout(resolve, ms));
}
