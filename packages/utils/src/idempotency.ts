export function generateIdempotencyKey(
  jobType: string,
  entityId: number | string,
  windowHours: number = 1,
): string {
  const now = new Date();
  const window = Math.floor(now.getTime() / (windowHours * 3600000));
  return `${jobType}:${entityId}:${window}`;
}
