export type InventoryStatus =
  | 'available'
  | 'assigned'
  | 'contacted'
  | 'converted'
  | 'exhausted'
  | 'archived';

export type Temperature = 'hot' | 'warm' | 'cold' | 'aged';

export type AgeBand = 'fresh' | 'recent' | 'aging' | 'stale' | 'expired';

export type MonetizationType =
  | 'direct_sale'
  | 'referral'
  | 'affiliate'
  | 'subscription'
  | 'marketplace';

export type PoolType =
  | 'platform'
  | 'tenant'
  | 'campaign'
  | 'segment'
  | 'recycled';

export interface LeadInventoryItem {
  id: number;
  canonicalLeadId: number;
  tenantId: number | null;
  inventoryStatus: InventoryStatus;
  temperature: Temperature;
  valueScore: number;
  ageBand: string | null;
  industry: string | null;
  geoRegion: string | null;
  persona: string | null;
  signalType: string | null;
  problemType: string | null;
  assignmentCount: number;
  contactCount: number;
  lastAssignedAt: Date | null;
  lastContactedAt: Date | null;
  monetizationEligible: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface LeadInventoryPool {
  id: number;
  tenantId: number | null;
  name: string;
  description: string | null;
  poolType: PoolType;
  filterCriteriaJson: Record<string, unknown>;
  leadCount: number;
  isActive: boolean;
  createdAt: Date;
}

export interface LeadPoolMembership {
  id: number;
  poolId: number;
  inventoryItemId: number;
  addedAt: Date;
  removedAt: Date | null;
  addedBy: string;
}

export interface LeadSegment {
  id: number;
  tenantId: number | null;
  name: string;
  segmentType: string;
  rulesJson: Record<string, unknown>;
  leadCount: number;
  isActive: boolean;
  createdAt: Date;
}

export interface LeadAgeBand {
  id: number;
  tenantId: number | null;
  bandName: string;
  minDays: number;
  maxDays: number | null;
  label: string;
  color: string | null;
  createdAt: Date;
}

export interface LeadValueScore {
  id: number;
  inventoryItemId: number;
  score: number;
  factorsJson: Record<string, unknown> | null;
  calculatedAt: Date;
}

export interface LeadMonetizationProfile {
  id: number;
  inventoryItemId: number;
  monetizationType: MonetizationType;
  estimatedValueCents: number | null;
  eligibleVerticals: string[];
  lastEvaluatedAt: Date | null;
  createdAt: Date;
}
