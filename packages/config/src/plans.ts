export const PLAN_LIMITS = {
  starter: { maxLeadsPerMonth: 500, maxSources: 3, maxUsers: 2, price: 97 },
  growth: { maxLeadsPerMonth: 2000, maxSources: 8, maxUsers: 5, price: 297 },
  pro: { maxLeadsPerMonth: 10000, maxSources: 50, maxUsers: 15, price: 597 },
  enterprise: { maxLeadsPerMonth: Infinity, maxSources: Infinity, maxUsers: Infinity, price: 0 },
} as const;
