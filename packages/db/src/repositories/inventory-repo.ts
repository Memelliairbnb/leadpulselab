import { db } from '../client';
import {
  leadInventoryItems,
  leadInventoryPools,
  leadPoolMemberships,
} from '../schema';
import { eq, and, desc, gte, lte, sql, isNull } from 'drizzle-orm';

export interface InventoryFilters {
  temperature?: string;
  age_band?: string;
  industry?: string;
  geo_region?: string;
  inventory_status?: string;
  value_score_min?: number;
  value_score_max?: number;
  monetization_eligible?: boolean;
  page?: number;
  limit?: number;
}

export const inventoryRepo = {
  async findOrCreateInventoryItem(canonicalLeadId: number, tenantId: number | null) {
    // Try to find existing
    const [existing] = await db
      .select()
      .from(leadInventoryItems)
      .where(eq(leadInventoryItems.canonicalLeadId, canonicalLeadId))
      .limit(1);

    if (existing) return existing;

    // Create new
    const [created] = await db
      .insert(leadInventoryItems)
      .values({ canonicalLeadId, tenantId })
      .returning();
    return created;
  },

  async updateInventoryItem(id: number, data: Partial<typeof leadInventoryItems.$inferInsert>) {
    const [updated] = await db
      .update(leadInventoryItems)
      .set({ ...data, updatedAt: new Date() })
      .where(eq(leadInventoryItems.id, id))
      .returning();
    return updated ?? null;
  },

  async findByFilters(filters: InventoryFilters) {
    const conditions: ReturnType<typeof eq>[] = [];

    if (filters.temperature) {
      conditions.push(eq(leadInventoryItems.temperature, filters.temperature));
    }
    if (filters.age_band) {
      conditions.push(eq(leadInventoryItems.ageBand, filters.age_band));
    }
    if (filters.industry) {
      conditions.push(eq(leadInventoryItems.industry, filters.industry));
    }
    if (filters.geo_region) {
      conditions.push(eq(leadInventoryItems.geoRegion, filters.geo_region));
    }
    if (filters.inventory_status) {
      conditions.push(eq(leadInventoryItems.inventoryStatus, filters.inventory_status));
    }
    if (filters.value_score_min !== undefined) {
      conditions.push(gte(leadInventoryItems.valueScore, filters.value_score_min));
    }
    if (filters.value_score_max !== undefined) {
      conditions.push(lte(leadInventoryItems.valueScore, filters.value_score_max));
    }
    if (filters.monetization_eligible !== undefined) {
      conditions.push(eq(leadInventoryItems.monetizationEligible, filters.monetization_eligible));
    }

    const page = filters.page ?? 1;
    const limit = filters.limit ?? 25;
    const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

    const [data, countResult] = await Promise.all([
      db
        .select()
        .from(leadInventoryItems)
        .where(whereClause)
        .orderBy(desc(leadInventoryItems.valueScore))
        .limit(limit)
        .offset((page - 1) * limit),
      db
        .select({ count: sql<number>`count(*)::int` })
        .from(leadInventoryItems)
        .where(whereClause),
    ]);

    const total = countResult[0]?.count ?? 0;

    return {
      data,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    };
  },

  // --- Pools ---

  async createPool(data: typeof leadInventoryPools.$inferInsert) {
    const [created] = await db.insert(leadInventoryPools).values(data).returning();
    return created;
  },

  async addToPool(poolId: number, inventoryItemId: number, addedBy: string) {
    const [created] = await db
      .insert(leadPoolMemberships)
      .values({ poolId, inventoryItemId, addedBy })
      .returning();

    // Increment pool lead count
    await db
      .update(leadInventoryPools)
      .set({ leadCount: sql`${leadInventoryPools.leadCount} + 1` })
      .where(eq(leadInventoryPools.id, poolId));

    return created;
  },

  async removeFromPool(poolId: number, inventoryItemId: number) {
    const [updated] = await db
      .update(leadPoolMemberships)
      .set({ removedAt: new Date() })
      .where(
        and(
          eq(leadPoolMemberships.poolId, poolId),
          eq(leadPoolMemberships.inventoryItemId, inventoryItemId),
          isNull(leadPoolMemberships.removedAt),
        ),
      )
      .returning();

    if (updated) {
      await db
        .update(leadInventoryPools)
        .set({ leadCount: sql`GREATEST(${leadInventoryPools.leadCount} - 1, 0)` })
        .where(eq(leadInventoryPools.id, poolId));
    }

    return updated ?? null;
  },

  async findPoolsByTenant(tenantId: number) {
    return db
      .select()
      .from(leadInventoryPools)
      .where(eq(leadInventoryPools.tenantId, tenantId));
  },

  // --- Stats ---

  async getInventoryStats(tenantId: number) {
    const [byTemperature, byAgeBand, byStatus] = await Promise.all([
      db
        .select({
          temperature: leadInventoryItems.temperature,
          count: sql<number>`count(*)::int`,
        })
        .from(leadInventoryItems)
        .where(eq(leadInventoryItems.tenantId, tenantId))
        .groupBy(leadInventoryItems.temperature),
      db
        .select({
          ageBand: leadInventoryItems.ageBand,
          count: sql<number>`count(*)::int`,
        })
        .from(leadInventoryItems)
        .where(eq(leadInventoryItems.tenantId, tenantId))
        .groupBy(leadInventoryItems.ageBand),
      db
        .select({
          status: leadInventoryItems.inventoryStatus,
          count: sql<number>`count(*)::int`,
        })
        .from(leadInventoryItems)
        .where(eq(leadInventoryItems.tenantId, tenantId))
        .groupBy(leadInventoryItems.inventoryStatus),
    ]);

    return { byTemperature, byAgeBand, byStatus };
  },

  async findMonetizableLeads(filters: InventoryFilters) {
    return this.findByFilters({ ...filters, monetization_eligible: true });
  },
};
