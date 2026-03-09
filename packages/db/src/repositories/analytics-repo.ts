import { db } from '../client';
import {
  tenantDashboardDailyStats,
  sourceHealthDailyStats,
  campaignPerformanceDaily,
  inventoryCountsBySegment,
  leadInventoryItems,
} from '../schema';
import { eq, and, gte, lte, sql } from 'drizzle-orm';

export const analyticsRepo = {
  // --- Tenant Daily Stats ---

  async upsertTenantDailyStats(
    tenantId: number,
    date: string,
    data: Partial<typeof tenantDashboardDailyStats.$inferInsert>,
  ) {
    const [existing] = await db
      .select()
      .from(tenantDashboardDailyStats)
      .where(
        and(
          eq(tenantDashboardDailyStats.tenantId, tenantId),
          eq(tenantDashboardDailyStats.statDate, date),
        ),
      )
      .limit(1);

    if (existing) {
      const [updated] = await db
        .update(tenantDashboardDailyStats)
        .set(data)
        .where(eq(tenantDashboardDailyStats.id, existing.id))
        .returning();
      return updated;
    }

    const [created] = await db
      .insert(tenantDashboardDailyStats)
      .values({ tenantId, statDate: date, ...data })
      .returning();
    return created;
  },

  async getTenantDailyStats(tenantId: number, startDate: string, endDate: string) {
    return db
      .select()
      .from(tenantDashboardDailyStats)
      .where(
        and(
          eq(tenantDashboardDailyStats.tenantId, tenantId),
          gte(tenantDashboardDailyStats.statDate, startDate),
          lte(tenantDashboardDailyStats.statDate, endDate),
        ),
      );
  },

  // --- Source Health Daily ---

  async upsertSourceHealthDaily(
    sourceId: number,
    date: string,
    data: Partial<typeof sourceHealthDailyStats.$inferInsert>,
  ) {
    const [existing] = await db
      .select()
      .from(sourceHealthDailyStats)
      .where(
        and(
          eq(sourceHealthDailyStats.sourceId, sourceId),
          eq(sourceHealthDailyStats.statDate, date),
        ),
      )
      .limit(1);

    if (existing) {
      const [updated] = await db
        .update(sourceHealthDailyStats)
        .set(data)
        .where(eq(sourceHealthDailyStats.id, existing.id))
        .returning();
      return updated;
    }

    const [created] = await db
      .insert(sourceHealthDailyStats)
      .values({ sourceId, statDate: date, ...data })
      .returning();
    return created;
  },

  async getSourceHealthDaily(sourceId: number, startDate: string, endDate: string) {
    return db
      .select()
      .from(sourceHealthDailyStats)
      .where(
        and(
          eq(sourceHealthDailyStats.sourceId, sourceId),
          gte(sourceHealthDailyStats.statDate, startDate),
          lte(sourceHealthDailyStats.statDate, endDate),
        ),
      );
  },

  // --- Campaign Performance Daily ---

  async upsertCampaignPerformanceDaily(
    tenantId: number,
    campaignName: string,
    date: string,
    data: Partial<typeof campaignPerformanceDaily.$inferInsert>,
  ) {
    const [existing] = await db
      .select()
      .from(campaignPerformanceDaily)
      .where(
        and(
          eq(campaignPerformanceDaily.tenantId, tenantId),
          eq(campaignPerformanceDaily.campaignName, campaignName),
          eq(campaignPerformanceDaily.statDate, date),
        ),
      )
      .limit(1);

    if (existing) {
      const [updated] = await db
        .update(campaignPerformanceDaily)
        .set(data)
        .where(eq(campaignPerformanceDaily.id, existing.id))
        .returning();
      return updated;
    }

    const [created] = await db
      .insert(campaignPerformanceDaily)
      .values({ tenantId, campaignName, statDate: date, ...data })
      .returning();
    return created;
  },

  // --- Inventory Snapshots ---

  async snapshotInventoryCounts(tenantId: number) {
    const segments = await db
      .select({
        temperature: leadInventoryItems.temperature,
        count: sql<number>`count(*)::int`,
        avgScore: sql<number>`coalesce(avg(${leadInventoryItems.valueScore})::numeric(5,2), 0)`,
      })
      .from(leadInventoryItems)
      .where(eq(leadInventoryItems.tenantId, tenantId))
      .groupBy(leadInventoryItems.temperature);

    const rows = segments.map((seg) => ({
      tenantId,
      segmentName: seg.temperature,
      temperature: seg.temperature,
      leadCount: seg.count,
      avgValueScore: String(seg.avgScore),
    }));

    if (rows.length > 0) {
      await db.insert(inventoryCountsBySegment).values(rows);
    }

    return rows;
  },
};
