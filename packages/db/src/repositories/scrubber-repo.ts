import { db } from '../client';
import {
  scrubRuns,
  duplicateCandidates,
  identityMerges,
  mergeDecisions,
  suppressionLogs,
} from '../schema';
import { eq, and, desc } from 'drizzle-orm';

export const scrubberRepo = {
  // --- Scrub Runs ---

  async createScrubRun(data: typeof scrubRuns.$inferInsert) {
    const [created] = await db.insert(scrubRuns).values(data).returning();
    return created;
  },

  async updateScrubRun(id: number, data: Partial<typeof scrubRuns.$inferInsert>) {
    const [updated] = await db
      .update(scrubRuns)
      .set(data)
      .where(eq(scrubRuns.id, id))
      .returning();
    return updated ?? null;
  },

  async getRecentScrubRuns(limit = 20) {
    return db
      .select()
      .from(scrubRuns)
      .orderBy(desc(scrubRuns.createdAt))
      .limit(limit);
  },

  // --- Duplicate Candidates ---

  async createDuplicateCandidate(data: typeof duplicateCandidates.$inferInsert) {
    const [created] = await db.insert(duplicateCandidates).values(data).returning();
    return created;
  },

  async findPendingDuplicates(scrubRunId: number) {
    return db
      .select()
      .from(duplicateCandidates)
      .where(
        and(
          eq(duplicateCandidates.scrubRunId, scrubRunId),
          eq(duplicateCandidates.resolution, 'pending'),
        ),
      );
  },

  async resolveDuplicateCandidate(
    id: number,
    resolution: string,
    resolvedBy: string,
  ) {
    const [updated] = await db
      .update(duplicateCandidates)
      .set({
        resolution,
        resolvedBy,
        resolvedAt: new Date(),
      })
      .where(eq(duplicateCandidates.id, id))
      .returning();
    return updated ?? null;
  },

  // --- Identity Merges ---

  async createIdentityMerge(data: typeof identityMerges.$inferInsert) {
    const [created] = await db.insert(identityMerges).values(data).returning();
    return created;
  },

  // --- Merge Decisions ---

  async createMergeDecision(data: typeof mergeDecisions.$inferInsert) {
    const [created] = await db.insert(mergeDecisions).values(data).returning();
    return created;
  },

  // --- Suppression ---

  async logSuppression(data: typeof suppressionLogs.$inferInsert) {
    const [created] = await db.insert(suppressionLogs).values(data).returning();
    return created;
  },
};
