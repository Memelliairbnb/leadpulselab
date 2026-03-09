import { db } from '../client';
import { qualifiedLeads, rawLeads, leadActivity, qualifiedLeadTags, leadTags, leadContacts } from '../schema';
import { eq, desc, and, gte, lte, sql, ilike, or } from 'drizzle-orm';
import type { LeadFilters } from '@alh/types';

export const leadRepo = {
  async findMany(tenantId: number, filters: LeadFilters) {
    const conditions: ReturnType<typeof eq>[] = [eq(qualifiedLeads.tenantId, tenantId)];

    if (filters.status) conditions.push(eq(qualifiedLeads.status, filters.status));
    if (filters.leadType) conditions.push(eq(qualifiedLeads.leadType, filters.leadType));
    if (filters.intentLevel) conditions.push(eq(qualifiedLeads.intentLevel, filters.intentLevel));
    if (filters.platform) conditions.push(eq(qualifiedLeads.platform, filters.platform));
    if (filters.minScore !== undefined) conditions.push(gte(qualifiedLeads.leadScore, filters.minScore));
    if (filters.maxScore !== undefined) conditions.push(lte(qualifiedLeads.leadScore, filters.maxScore));
    if (filters.assignedTo !== undefined) conditions.push(eq(qualifiedLeads.assignedToUserId, filters.assignedTo));
    if (filters.needsReview !== undefined) conditions.push(eq(qualifiedLeads.needsReview, filters.needsReview));
    if (filters.isDuplicate !== undefined) conditions.push(eq(qualifiedLeads.isDuplicate, filters.isDuplicate));
    if (filters.search) {
      conditions.push(
        or(
          ilike(qualifiedLeads.fullName, `%${filters.search}%`),
          ilike(qualifiedLeads.companyName, `%${filters.search}%`),
          ilike(qualifiedLeads.aiSummary, `%${filters.search}%`),
        )!,
      );
    }

    const page = filters.page ?? 1;
    const limit = filters.limit ?? 25;

    const sortColumn = filters.sortBy === 'created_at' ? qualifiedLeads.createdAt :
                       filters.sortBy === 'score' ? qualifiedLeads.leadScore :
                       filters.sortBy === 'status' ? qualifiedLeads.status :
                       qualifiedLeads.leadScore;
    const order = filters.sortOrder === 'asc' ? sortColumn : desc(sortColumn);

    const [data, countResult] = await Promise.all([
      db
        .select()
        .from(qualifiedLeads)
        .where(and(...conditions))
        .orderBy(order)
        .limit(limit)
        .offset((page - 1) * limit),
      db
        .select({ count: sql<number>`count(*)::int` })
        .from(qualifiedLeads)
        .where(and(...conditions)),
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

  async findById(tenantId: number, id: number) {
    const [lead] = await db
      .select()
      .from(qualifiedLeads)
      .where(and(eq(qualifiedLeads.id, id), eq(qualifiedLeads.tenantId, tenantId)))
      .limit(1);
    return lead ?? null;
  },

  async findByIdWithDetails(tenantId: number, id: number) {
    const lead = await this.findById(tenantId, id);
    if (!lead) return null;

    const [tags, contacts, activity, rawLead] = await Promise.all([
      db
        .select({ tagName: leadTags.name, tagCategory: leadTags.category, source: qualifiedLeadTags.source })
        .from(qualifiedLeadTags)
        .innerJoin(leadTags, eq(qualifiedLeadTags.tagId, leadTags.id))
        .where(eq(qualifiedLeadTags.leadId, id)),
      db.select().from(leadContacts).where(eq(leadContacts.leadId, id)),
      db
        .select()
        .from(leadActivity)
        .where(eq(leadActivity.leadId, id))
        .orderBy(desc(leadActivity.createdAt))
        .limit(50),
      lead.rawLeadId
        ? db.select().from(rawLeads).where(eq(rawLeads.id, lead.rawLeadId)).limit(1)
        : Promise.resolve([]),
    ]);

    return {
      ...lead,
      tags,
      contacts,
      activity,
      rawLead: rawLead[0] ?? null,
    };
  },

  async create(data: typeof qualifiedLeads.$inferInsert) {
    const [created] = await db.insert(qualifiedLeads).values(data).returning();
    return created;
  },

  async updateStatus(tenantId: number, id: number, status: string, userId?: number) {
    const [updated] = await db
      .update(qualifiedLeads)
      .set({ status, updatedAt: new Date() })
      .where(and(eq(qualifiedLeads.id, id), eq(qualifiedLeads.tenantId, tenantId)))
      .returning();

    if (updated) {
      await db.insert(leadActivity).values({
        tenantId,
        leadId: id,
        activityType: 'status_changed',
        description: `Status changed to ${status}`,
        performedBy: userId ?? null,
      });
    }

    return updated ?? null;
  },

  async assign(tenantId: number, id: number, assignToUserId: number, performedBy?: number) {
    const [updated] = await db
      .update(qualifiedLeads)
      .set({ assignedToUserId: assignToUserId, updatedAt: new Date() })
      .where(and(eq(qualifiedLeads.id, id), eq(qualifiedLeads.tenantId, tenantId)))
      .returning();

    if (updated) {
      await db.insert(leadActivity).values({
        tenantId,
        leadId: id,
        activityType: 'assigned',
        description: `Assigned to user ${assignToUserId}`,
        performedBy: performedBy ?? null,
      });
    }

    return updated ?? null;
  },

  async markDuplicate(id: number, duplicateOfId: number, confidence: number) {
    await db
      .update(qualifiedLeads)
      .set({
        isDuplicate: true,
        duplicateOfLeadId: duplicateOfId,
        duplicateConfidence: String(confidence),
        updatedAt: new Date(),
      })
      .where(eq(qualifiedLeads.id, id));
  },
};
