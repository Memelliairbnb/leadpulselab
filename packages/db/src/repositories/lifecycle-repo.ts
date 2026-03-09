import { db } from '../client';
import {
  leadLifecycleEvents,
  campaignAssignments,
  pipelineHistory,
} from '../schema';
import { eq, and, desc } from 'drizzle-orm';

export const lifecycleRepo = {
  // --- Lifecycle Events ---

  async logLifecycleEvent(data: typeof leadLifecycleEvents.$inferInsert) {
    const [created] = await db.insert(leadLifecycleEvents).values(data).returning();
    return created;
  },

  async findEventsByCanonicalLead(canonicalLeadId: number, limit = 50) {
    return db
      .select()
      .from(leadLifecycleEvents)
      .where(eq(leadLifecycleEvents.canonicalLeadId, canonicalLeadId))
      .orderBy(desc(leadLifecycleEvents.createdAt))
      .limit(limit);
  },

  // --- Campaign Assignments ---

  async createCampaignAssignment(data: typeof campaignAssignments.$inferInsert) {
    const [created] = await db.insert(campaignAssignments).values(data).returning();
    return created;
  },

  async updateCampaignAssignment(
    id: number,
    data: Partial<typeof campaignAssignments.$inferInsert>,
  ) {
    const [updated] = await db
      .update(campaignAssignments)
      .set(data)
      .where(eq(campaignAssignments.id, id))
      .returning();
    return updated ?? null;
  },

  async findCampaignAssignmentsByTenant(
    tenantId: number,
    filters?: { status?: string; campaignName?: string },
  ) {
    const conditions: ReturnType<typeof eq>[] = [
      eq(campaignAssignments.tenantId, tenantId),
    ];

    if (filters?.status) {
      conditions.push(eq(campaignAssignments.status, filters.status));
    }
    if (filters?.campaignName) {
      conditions.push(eq(campaignAssignments.campaignName, filters.campaignName));
    }

    return db
      .select()
      .from(campaignAssignments)
      .where(and(...conditions))
      .orderBy(desc(campaignAssignments.assignedAt));
  },

  // --- Pipeline History ---

  async logPipelineStage(data: typeof pipelineHistory.$inferInsert) {
    const [created] = await db.insert(pipelineHistory).values(data).returning();
    return created;
  },
};
