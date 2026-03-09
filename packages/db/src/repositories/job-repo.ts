import { db } from '../client';
import { scanJobs, jobRuns } from '../schema';
import { eq, and, desc } from 'drizzle-orm';

export const jobRepo = {
  async createScanJob(data: typeof scanJobs.$inferInsert) {
    const [created] = await db.insert(scanJobs).values(data).returning();
    return created;
  },

  async updateScanJob(id: number, data: Partial<typeof scanJobs.$inferInsert>) {
    const [updated] = await db
      .update(scanJobs)
      .set(data)
      .where(eq(scanJobs.id, id))
      .returning();
    return updated ?? null;
  },

  async findScanJobsByTenant(tenantId: number, limit = 50) {
    return db
      .select()
      .from(scanJobs)
      .where(eq(scanJobs.tenantId, tenantId))
      .orderBy(desc(scanJobs.createdAt))
      .limit(limit);
  },

  async createJobRun(data: typeof jobRuns.$inferInsert) {
    const [created] = await db.insert(jobRuns).values(data).returning();
    return created;
  },

  async updateJobRun(id: number, data: Partial<typeof jobRuns.$inferInsert>) {
    const [updated] = await db
      .update(jobRuns)
      .set(data)
      .where(eq(jobRuns.id, id))
      .returning();
    return updated ?? null;
  },

  async findJobRunByIdempotencyKey(key: string) {
    const [found] = await db
      .select()
      .from(jobRuns)
      .where(and(eq(jobRuns.idempotencyKey, key), eq(jobRuns.status, 'completed')))
      .limit(1);
    return found ?? null;
  },

  async findJobRunsByTenant(tenantId: number, limit = 50) {
    return db
      .select()
      .from(jobRuns)
      .where(eq(jobRuns.tenantId, tenantId))
      .orderBy(desc(jobRuns.createdAt))
      .limit(limit);
  },
};
