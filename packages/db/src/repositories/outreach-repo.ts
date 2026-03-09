import { db } from '../client';
import { outreachDrafts, optOuts, leadActivity } from '../schema';
import { eq, and, desc } from 'drizzle-orm';

export const outreachRepo = {
  async findDraftsByLead(leadId: number) {
    return db
      .select()
      .from(outreachDrafts)
      .where(eq(outreachDrafts.leadId, leadId))
      .orderBy(desc(outreachDrafts.version));
  },

  async findPendingDraftsByTenant(tenantId: number) {
    return db
      .select()
      .from(outreachDrafts)
      .where(
        and(
          eq(outreachDrafts.tenantId, tenantId),
          eq(outreachDrafts.status, 'pending_review'),
        ),
      )
      .orderBy(desc(outreachDrafts.createdAt));
  },

  async createDraft(data: typeof outreachDrafts.$inferInsert) {
    const [created] = await db.insert(outreachDrafts).values(data).returning();
    return created;
  },

  async approveDraft(tenantId: number, draftId: number, reviewedBy: number) {
    const [updated] = await db
      .update(outreachDrafts)
      .set({
        status: 'approved',
        reviewedBy,
        reviewedAt: new Date(),
      })
      .where(
        and(eq(outreachDrafts.id, draftId), eq(outreachDrafts.tenantId, tenantId)),
      )
      .returning();

    if (updated) {
      await db.insert(leadActivity).values({
        tenantId,
        leadId: updated.leadId,
        activityType: 'outreach_approved',
        description: `Outreach draft v${updated.version} approved`,
        performedBy: reviewedBy,
      });
    }

    return updated ?? null;
  },

  async rejectDraft(tenantId: number, draftId: number, reviewedBy: number, reason: string) {
    const [updated] = await db
      .update(outreachDrafts)
      .set({
        status: 'rejected',
        reviewedBy,
        reviewedAt: new Date(),
        rejectionReason: reason,
      })
      .where(
        and(eq(outreachDrafts.id, draftId), eq(outreachDrafts.tenantId, tenantId)),
      )
      .returning();

    return updated ?? null;
  },

  async isOptedOut(tenantId: number, identifier: string, identifierType: string) {
    const [found] = await db
      .select()
      .from(optOuts)
      .where(
        and(
          eq(optOuts.tenantId, tenantId),
          eq(optOuts.identifier, identifier),
          eq(optOuts.identifierType, identifierType),
        ),
      )
      .limit(1);
    return !!found;
  },

  async addOptOut(data: typeof optOuts.$inferInsert) {
    const [created] = await db.insert(optOuts).values(data).returning();
    return created;
  },
};
