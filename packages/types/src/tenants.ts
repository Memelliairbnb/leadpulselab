export interface Tenant {
  id: number;
  name: string;
  slug: string;
  industry: string | null;
  plan: TenantPlan;
  isActive: boolean;
  onboardingTemplate: string | null;
  settingsJson: Record<string, unknown>;
  maxLeadsPerMonth: number;
  maxSources: number;
  maxUsers: number;
  stripeCustomerId: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export type TenantPlan = 'starter' | 'growth' | 'pro' | 'enterprise';

export interface TenantMember {
  id: number;
  tenantId: number;
  userId: number;
  role: TenantRole;
  invitedBy: number | null;
  joinedAt: Date;
}

export type TenantRole = 'admin' | 'manager' | 'reviewer' | 'viewer';

export interface TenantLeadType {
  id: number;
  tenantId: number;
  name: string;
  displayName: string;
  description: string | null;
  priority: number;
  color: string | null;
  isActive: boolean;
  createdAt: Date;
}

export interface TenantScoringModel {
  id: number;
  tenantId: number;
  name: string;
  isActive: boolean;
  claudeWeight: number;
  rulesWeight: number;
  hotThreshold: number;
  strongThreshold: number;
  nurtureThreshold: number;
  createdAt: Date;
}

export interface TenantScoringSignal {
  id: number;
  scoringModelId: number;
  signalKey: string;
  signalPattern: string;
  weight: number;
  description: string | null;
  isActive: boolean;
}

export interface TenantOutreachTemplate {
  id: number;
  tenantId: number;
  name: string;
  leadTypeId: number | null;
  channel: string;
  subjectTemplate: string | null;
  bodyTemplate: string;
  tone: string;
  isActive: boolean;
  createdAt: Date;
}

export interface TenantAIConfig {
  id: number;
  tenantId: number;
  industryContext: string;
  classificationInstructions: string | null;
  scoringInstructions: string | null;
  outreachInstructions: string | null;
  exampleSignalsJson: string[];
  irrelevantSignalsJson: string[];
  updatedAt: Date;
}

export interface VerticalTemplate {
  id: number;
  name: string;
  displayName: string;
  industry: string;
  description: string | null;
  configJson: VerticalTemplateConfig;
  isActive: boolean;
  createdAt: Date;
}

export interface VerticalTemplateConfig {
  leadTypes: Array<{
    name: string;
    displayName: string;
    description: string;
    priority: number;
    color: string;
  }>;
  keywordCategories: Array<{
    name: string;
    keywords: Array<{
      keyword: string;
      type: 'phrase' | 'hashtag' | 'regex';
    }>;
  }>;
  /** Intent phrases specific to this vertical (combined with defaults in query builder) */
  intentPhrases?: string[];
  /** High-signal sites to target with site: operators */
  targetSites?: string[];
  scoringSignals: Array<{
    signalKey: string;
    signalPattern: string;
    weight: number;
    description: string;
  }>;
  outreachTemplates: Array<{
    name: string;
    leadTypeName: string | null;
    channel: string;
    subject: string | null;
    body: string;
    tone: string;
  }>;
  aiConfig: {
    industryContext: string;
    classificationInstructions: string | null;
    exampleSignals: string[];
    irrelevantSignals: string[];
  };
}
