import { db } from '../client';
import {
  queryRuns,
  sourceFetchRuns,
  rawSourceBlobs,
  sourceHealthMetrics,
  sourceQualityScores,
} from '../schema';
import { eq, desc } from 'drizzle-orm';

export const sourcingRepo = {
  // --- Query Runs ---

  async createQueryRun(data: typeof queryRuns.$inferInsert) {
    const [created] = await db.insert(queryRuns).values(data).returning();
    return created;
  },

  async updateQueryRun(id: number, data: Partial<typeof queryRuns.$inferInsert>) {
    const [updated] = await db
      .update(queryRuns)
      .set(data)
      .where(eq(queryRuns.id, id))
      .returning();
    return updated ?? null;
  },

  // --- Source Fetch Runs ---

  async createSourceFetchRun(data: typeof sourceFetchRuns.$inferInsert) {
    const [created] = await db.insert(sourceFetchRuns).values(data).returning();
    return created;
  },

  async updateSourceFetchRun(id: number, data: Partial<typeof sourceFetchRuns.$inferInsert>) {
    const [updated] = await db
      .update(sourceFetchRuns)
      .set(data)
      .where(eq(sourceFetchRuns.id, id))
      .returning();
    return updated ?? null;
  },

  // --- Raw Source Blobs ---

  async storeRawBlob(data: typeof rawSourceBlobs.$inferInsert) {
    // Check for duplicate by checksum first
    const exists = await this.rawBlobExistsByChecksum(data.checksumHash);
    if (exists) return null;

    const [created] = await db.insert(rawSourceBlobs).values(data).returning();
    return created;
  },

  async rawBlobExistsByChecksum(hash: string) {
    const [result] = await db
      .select({ id: rawSourceBlobs.id })
      .from(rawSourceBlobs)
      .where(eq(rawSourceBlobs.checksumHash, hash))
      .limit(1);
    return !!result;
  },

  // --- Source Health Metrics ---

  async getSourceHealthMetrics(sourceId: number) {
    return db
      .select()
      .from(sourceHealthMetrics)
      .where(eq(sourceHealthMetrics.sourceId, sourceId))
      .orderBy(desc(sourceHealthMetrics.calculatedAt));
  },

  // --- Source Quality Scores ---

  async upsertSourceQualityScore(
    sourceId: number,
    data: Partial<typeof sourceQualityScores.$inferInsert>,
  ) {
    const [existing] = await db
      .select()
      .from(sourceQualityScores)
      .where(eq(sourceQualityScores.sourceId, sourceId))
      .limit(1);

    if (existing) {
      const [updated] = await db
        .update(sourceQualityScores)
        .set({ ...data, updatedAt: new Date() })
        .where(eq(sourceQualityScores.sourceId, sourceId))
        .returning();
      return updated;
    }

    const [created] = await db
      .insert(sourceQualityScores)
      .values({ sourceId, ...data })
      .returning();
    return created;
  },
};
