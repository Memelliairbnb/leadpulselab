import { db } from '../client';
import {
  tenants,
  tenantLeadTypes,
  tenantScoringModels,
  tenantScoringSignals,
  tenantOutreachTemplates,
  tenantAiConfig,
  tenantMembers,
} from '../schema';
import { eq, and } from 'drizzle-orm';

export const tenantRepo = {
  async findById(id: number) {
    const [tenant] = await db.select().from(tenants).where(eq(tenants.id, id)).limit(1);
    return tenant ?? null;
  },

  async findBySlug(slug: string) {
    const [tenant] = await db.select().from(tenants).where(eq(tenants.slug, slug)).limit(1);
    return tenant ?? null;
  },

  async create(data: typeof tenants.$inferInsert) {
    const [created] = await db.insert(tenants).values(data).returning();
    return created;
  },

  async addMember(data: typeof tenantMembers.$inferInsert) {
    const [created] = await db.insert(tenantMembers).values(data).returning();
    return created;
  },

  async findMembersByTenant(tenantId: number) {
    return db.select().from(tenantMembers).where(eq(tenantMembers.tenantId, tenantId));
  },

  async findMembership(userId: number, tenantId: number) {
    const [found] = await db
      .select()
      .from(tenantMembers)
      .where(and(eq(tenantMembers.userId, userId), eq(tenantMembers.tenantId, tenantId)))
      .limit(1);
    return found ?? null;
  },

  // Lead Types
  async findLeadTypes(tenantId: number) {
    return db
      .select()
      .from(tenantLeadTypes)
      .where(eq(tenantLeadTypes.tenantId, tenantId));
  },

  async createLeadType(data: typeof tenantLeadTypes.$inferInsert) {
    const [created] = await db.insert(tenantLeadTypes).values(data).returning();
    return created;
  },

  // Scoring
  async findActiveScoringModel(tenantId: number) {
    const [model] = await db
      .select()
      .from(tenantScoringModels)
      .where(and(eq(tenantScoringModels.tenantId, tenantId), eq(tenantScoringModels.isActive, true)))
      .limit(1);
    if (!model) return null;

    const signals = await db
      .select()
      .from(tenantScoringSignals)
      .where(and(eq(tenantScoringSignals.scoringModelId, model.id), eq(tenantScoringSignals.isActive, true)));

    return { ...model, signals };
  },

  // AI Config
  async findAiConfig(tenantId: number) {
    const [config] = await db
      .select()
      .from(tenantAiConfig)
      .where(eq(tenantAiConfig.tenantId, tenantId))
      .limit(1);
    return config ?? null;
  },

  async upsertAiConfig(tenantId: number, data: Partial<typeof tenantAiConfig.$inferInsert>) {
    const existing = await this.findAiConfig(tenantId);
    if (existing) {
      const [updated] = await db
        .update(tenantAiConfig)
        .set({ ...data, updatedAt: new Date() })
        .where(eq(tenantAiConfig.tenantId, tenantId))
        .returning();
      return updated;
    }
    const [created] = await db
      .insert(tenantAiConfig)
      .values({ tenantId, industryContext: '', ...data })
      .returning();
    return created;
  },

  // Outreach Templates
  async findOutreachTemplates(tenantId: number) {
    return db
      .select()
      .from(tenantOutreachTemplates)
      .where(eq(tenantOutreachTemplates.tenantId, tenantId));
  },
};
