import { db } from '../client';
import {
  canonicalLeads,
  leadIdentities,
  identityLinks,
  leadDomains,
  leadFreshnessScores,
  leadVerificationStatus,
} from '../schema';
import { eq, and, desc, ilike, gte, lte, sql, or } from 'drizzle-orm';

export interface CanonicalLeadFilters {
  industry?: string;
  geo?: string;
  persona?: string;
  lifecycle_state?: string;
  freshness_min?: number;
  freshness_max?: number;
  verification_status?: string;
  search?: string;
  page?: number;
  limit?: number;
}

export const canonicalRepo = {
  async findById(id: number) {
    const [lead] = await db
      .select()
      .from(canonicalLeads)
      .where(eq(canonicalLeads.id, id))
      .limit(1);
    return lead ?? null;
  },

  async findByNormalizedName(name: string) {
    const [lead] = await db
      .select()
      .from(canonicalLeads)
      .where(eq(canonicalLeads.normalizedName, name))
      .limit(1);
    return lead ?? null;
  },

  async findByEmail(email: string) {
    const [lead] = await db
      .select()
      .from(canonicalLeads)
      .where(eq(canonicalLeads.primaryEmail, email))
      .limit(1);
    return lead ?? null;
  },

  async findByDomain(domain: string) {
    return db
      .select()
      .from(canonicalLeads)
      .where(eq(canonicalLeads.normalizedDomain, domain));
  },

  async create(data: typeof canonicalLeads.$inferInsert) {
    const [created] = await db.insert(canonicalLeads).values(data).returning();
    return created;
  },

  async update(id: number, data: Partial<typeof canonicalLeads.$inferInsert>) {
    const [updated] = await db
      .update(canonicalLeads)
      .set({ ...data, updatedAt: new Date() })
      .where(eq(canonicalLeads.id, id))
      .returning();
    return updated ?? null;
  },

  async updateLifecycleState(
    id: number,
    newState: string,
    metadata?: Record<string, unknown>,
  ) {
    const existing = await this.findById(id);
    if (!existing) return null;

    const [updated] = await db
      .update(canonicalLeads)
      .set({ lifecycleState: newState, updatedAt: new Date() })
      .where(eq(canonicalLeads.id, id))
      .returning();
    return updated ?? null;
  },

  // --- Lead Identities ---

  async addIdentity(data: typeof leadIdentities.$inferInsert) {
    const [created] = await db.insert(leadIdentities).values(data).returning();
    return created;
  },

  async findIdentitiesByCanonicalId(canonicalLeadId: number) {
    return db
      .select()
      .from(leadIdentities)
      .where(eq(leadIdentities.canonicalLeadId, canonicalLeadId));
  },

  async findIdentityByPlatform(platform: string, platformId: string) {
    const [identity] = await db
      .select()
      .from(leadIdentities)
      .where(
        and(
          eq(leadIdentities.platform, platform),
          eq(leadIdentities.platformId, platformId),
        ),
      )
      .limit(1);
    return identity ?? null;
  },

  // --- Lead Domains ---

  async addDomain(data: typeof leadDomains.$inferInsert) {
    const [created] = await db.insert(leadDomains).values(data).returning();
    return created;
  },

  // --- Filtered Search ---

  async findByFilters(filters: CanonicalLeadFilters) {
    const conditions: ReturnType<typeof eq>[] = [];

    if (filters.industry) {
      conditions.push(eq(canonicalLeads.industryInference, filters.industry));
    }
    if (filters.geo) {
      conditions.push(eq(canonicalLeads.geoRegion, filters.geo));
    }
    if (filters.persona) {
      conditions.push(eq(canonicalLeads.personaInference, filters.persona));
    }
    if (filters.lifecycle_state) {
      conditions.push(eq(canonicalLeads.lifecycleState, filters.lifecycle_state));
    }
    if (filters.freshness_min !== undefined) {
      conditions.push(gte(canonicalLeads.freshnessScore, filters.freshness_min));
    }
    if (filters.freshness_max !== undefined) {
      conditions.push(lte(canonicalLeads.freshnessScore, filters.freshness_max));
    }
    if (filters.verification_status) {
      conditions.push(eq(canonicalLeads.verificationStatus, filters.verification_status));
    }
    if (filters.search) {
      conditions.push(
        or(
          ilike(canonicalLeads.normalizedName, `%${filters.search}%`),
          ilike(canonicalLeads.companyName, `%${filters.search}%`),
          ilike(canonicalLeads.primaryEmail, `%${filters.search}%`),
        )!,
      );
    }

    const page = filters.page ?? 1;
    const limit = filters.limit ?? 25;
    const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

    const [data, countResult] = await Promise.all([
      db
        .select()
        .from(canonicalLeads)
        .where(whereClause)
        .orderBy(desc(canonicalLeads.createdAt))
        .limit(limit)
        .offset((page - 1) * limit),
      db
        .select({ count: sql<number>`count(*)::int` })
        .from(canonicalLeads)
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
};
