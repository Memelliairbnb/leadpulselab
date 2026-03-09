import { db } from '../client';
import { keywordCategories, keywordLibrary } from '../schema';
import { eq, and } from 'drizzle-orm';

export const keywordRepo = {
  async findCategoriesByTenant(tenantId: number) {
    return db
      .select()
      .from(keywordCategories)
      .where(eq(keywordCategories.tenantId, tenantId));
  },

  async findKeywordsByTenant(tenantId: number, activeOnly = true) {
    const conditions = [eq(keywordLibrary.tenantId, tenantId)];
    if (activeOnly) conditions.push(eq(keywordLibrary.isActive, true));

    return db
      .select()
      .from(keywordLibrary)
      .where(and(...conditions));
  },

  async findKeywordsByCategory(tenantId: number, categoryId: number) {
    return db
      .select()
      .from(keywordLibrary)
      .where(
        and(
          eq(keywordLibrary.tenantId, tenantId),
          eq(keywordLibrary.categoryId, categoryId),
        ),
      );
  },

  async createCategory(data: typeof keywordCategories.$inferInsert) {
    const [created] = await db.insert(keywordCategories).values(data).returning();
    return created;
  },

  async createKeyword(data: typeof keywordLibrary.$inferInsert) {
    const [created] = await db.insert(keywordLibrary).values(data).returning();
    return created;
  },

  async updateKeyword(tenantId: number, id: number, data: Partial<typeof keywordLibrary.$inferInsert>) {
    const [updated] = await db
      .update(keywordLibrary)
      .set(data)
      .where(and(eq(keywordLibrary.id, id), eq(keywordLibrary.tenantId, tenantId)))
      .returning();
    return updated ?? null;
  },

  async incrementMatchCount(id: number) {
    await db.execute(
      `UPDATE keyword_library SET match_count = match_count + 1 WHERE id = ${id}`,
    );
  },
};
