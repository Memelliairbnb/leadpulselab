import { db } from '../client';
import { platformSources, rawSources, sourceErrors } from '../schema';
import { eq, and } from 'drizzle-orm';

export const sourceRepo = {
  async findByTenant(tenantId: number) {
    return db
      .select()
      .from(platformSources)
      .where(eq(platformSources.tenantId, tenantId));
  },

  async findEnabledByTenant(tenantId: number) {
    return db
      .select()
      .from(platformSources)
      .where(
        and(
          eq(platformSources.tenantId, tenantId),
          eq(platformSources.isEnabled, true),
        ),
      );
  },

  async findById(tenantId: number, id: number) {
    const [source] = await db
      .select()
      .from(platformSources)
      .where(and(eq(platformSources.id, id), eq(platformSources.tenantId, tenantId)))
      .limit(1);
    return source ?? null;
  },

  async update(tenantId: number, id: number, data: Partial<typeof platformSources.$inferInsert>) {
    const [updated] = await db
      .update(platformSources)
      .set({ ...data, updatedAt: new Date() })
      .where(and(eq(platformSources.id, id), eq(platformSources.tenantId, tenantId)))
      .returning();
    return updated ?? null;
  },

  async createRawSource(data: typeof rawSources.$inferInsert) {
    const [created] = await db.insert(rawSources).values(data).returning();
    return created;
  },

  async rawSourceExistsByChecksum(checksumHash: string) {
    const [result] = await db
      .select({ id: rawSources.id })
      .from(rawSources)
      .where(eq(rawSources.checksumHash, checksumHash))
      .limit(1);
    return !!result;
  },

  async logError(data: typeof sourceErrors.$inferInsert) {
    await db.insert(sourceErrors).values(data);
  },
};
