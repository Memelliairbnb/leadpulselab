export interface PaginatedResponse<T> {
  data: T[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}

export interface ApiError {
  error: string;
  message: string;
  statusCode: number;
}

export interface LeadFilters {
  status?: string;
  leadType?: string;
  intentLevel?: string;
  platform?: string;
  resolutionStatus?: string;
  resolutionTab?: 'qualified' | 'in_progress' | 'inventory' | 'all';
  minScore?: number;
  maxScore?: number;
  assignedTo?: number;
  needsReview?: boolean;
  isDuplicate?: boolean;
  search?: string;
  page?: number;
  limit?: number;
  sortBy?: string;
  sortOrder?: 'asc' | 'desc';
}

export interface AnalyticsOverview {
  totalLeads: number;
  leadsToday: number;
  leadsByScoreBand: {
    hot: number;
    strong: number;
    nurture: number;
    archive: number;
  };
  leadsByType: Record<string, number>;
  leadsByPlatform: Record<string, number>;
  scanJobs24h: {
    completed: number;
    failed: number;
  };
  outreachPending: number;
  /** Resolution pipeline stats — optional for backward compatibility */
  resolution?: {
    totalSignals: number;
    inResolution: number;
    qualified: number;
    inventory: number;
    resolutionRate: number;
  };
}

export interface AuthSession {
  userId: number;
  tenantId: number;
  email: string;
  fullName: string;
  role: string;
}
