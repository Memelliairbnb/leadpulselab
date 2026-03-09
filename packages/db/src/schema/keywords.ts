import {
  pgTable,
  serial,
  varchar,
  boolean,
  integer,
  text,
  timestamp,
  index,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { tenants } from './tenants';

export const keywordCategories = pgTable(
  'keyword_categories',
  {
    id: serial('id').primaryKey(),
    tenantId: integer('tenant_id').notNull().references(() => tenants.id),
    name: varchar('name', { length: 100 }).notNull(),
    description: text('description'),
    isActive: boolean('is_active').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('uq_keyword_categories_tenant_name').on(table.tenantId, table.name),
    index('idx_keyword_categories_tenant').on(table.tenantId),
  ],
);

export const keywordLibrary = pgTable(
  'keyword_library',
  {
    id: serial('id').primaryKey(),
    tenantId: integer('tenant_id').notNull().references(() => tenants.id),
    categoryId: integer('category_id').notNull().references(() => keywordCategories.id),
    keyword: varchar('keyword', { length: 255 }).notNull(),
    keywordType: varchar('keyword_type', { length: 20 }).notNull().default('phrase'),
    isActive: boolean('is_active').notNull().default(true),
    matchCount: integer('match_count').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('uq_keyword_library_cat_keyword').on(table.categoryId, table.keyword),
    index('idx_keyword_library_tenant').on(table.tenantId),
    index('idx_keyword_library_active').on(table.isActive),
  ],
);
