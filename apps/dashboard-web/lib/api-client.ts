import type {
  PaginatedResponse,
  QualifiedLead,
  LeadFilters,
  LeadContact,
  LeadActivity,
  OutreachDraft,
  PlatformSource,
  KeywordCategory,
  Keyword,
  ScanJob,
  AnalyticsOverview,
} from '@alh/types';

class ApiClient {
  private baseUrl: string;

  constructor(baseUrl = '/api/proxy') {
    this.baseUrl = baseUrl;
  }

  private async request<T>(
    path: string,
    options: RequestInit = {}
  ): Promise<T> {
    const res = await fetch(`${this.baseUrl}/${path}`, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        ...options.headers,
      },
    });

    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new ApiError(
        body.message || `Request failed: ${res.status}`,
        res.status
      );
    }

    return res.json();
  }

  /**
   * Helper: many API endpoints return { data: T[] }.
   * This unwraps the .data property.
   */
  private async requestData<T>(
    path: string,
    options: RequestInit = {}
  ): Promise<T[]> {
    const res = await this.request<{ data: T[] }>(path, options);
    return res.data ?? [];
  }

  // ---- Leads ----

  async getLeads(filters: LeadFilters = {}): Promise<PaginatedResponse<QualifiedLead>> {
    const params = new URLSearchParams();
    for (const [key, val] of Object.entries(filters)) {
      if (val !== undefined && val !== null && val !== '') {
        params.set(key, String(val));
      }
    }
    return this.request(`leads?${params.toString()}`);
  }

  async getLead(id: number): Promise<QualifiedLead> {
    return this.request(`leads/${id}`);
  }

  // Note: contacts, activity, and outreach drafts are returned embedded
  // in the getLead() response from findByIdWithDetails().

  async updateLeadStatus(id: number, status: string): Promise<QualifiedLead> {
    return this.request(`leads/${id}/status`, {
      method: 'PATCH',
      body: JSON.stringify({ status }),
    });
  }

  async createManualLead(data: {
    fullName?: string;
    email?: string;
    phone?: string;
    platform?: string;
    sourceUrl?: string;
    rawText?: string;
    notes?: string;
  }): Promise<{ message: string; rawLeadId: number }> {
    return this.request('leads/manual', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  // ---- Outreach ----

  async getPendingOutreach(): Promise<PaginatedResponse<OutreachDraft & { lead?: QualifiedLead }>> {
    return this.request('outreach?status=pending_review');
  }

  async approveOutreach(id: number): Promise<OutreachDraft> {
    return this.request(`outreach/${id}/approve`, { method: 'POST' });
  }

  async rejectOutreach(id: number, reason: string): Promise<OutreachDraft> {
    return this.request(`outreach/${id}/reject`, {
      method: 'POST',
      body: JSON.stringify({ reason }),
    });
  }

  // ---- Sources ----

  async getSources(): Promise<PlatformSource[]> {
    return this.requestData<PlatformSource>('sources');
  }

  async toggleSource(id: number, enabled: boolean): Promise<PlatformSource> {
    return this.request(`sources/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({ isEnabled: enabled }),
    });
  }

  // ---- Keywords ----
  // API routes: /api/keyword-categories, /api/keywords

  async getKeywordCategories(): Promise<KeywordCategory[]> {
    return this.requestData<KeywordCategory>('keyword-categories');
  }

  async getKeywords(categoryId?: number): Promise<Keyword[]> {
    const params = categoryId ? `?categoryId=${categoryId}` : '';
    return this.requestData<Keyword>(`keywords${params}`);
  }

  async createKeyword(data: {
    categoryId: number;
    keyword: string;
    keywordType: string;
  }): Promise<Keyword> {
    return this.request('keywords', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  async toggleKeyword(id: number, isActive: boolean): Promise<Keyword> {
    return this.request(`keywords/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({ isActive }),
    });
  }

  async deleteKeyword(id: number): Promise<void> {
    return this.request(`keywords/${id}`, { method: 'DELETE' });
  }

  // ---- Scans / Jobs ----
  // API routes: /api/scan-jobs, /api/scan-jobs/run

  async getScanJobs(page = 1, limit = 25): Promise<PaginatedResponse<ScanJob>> {
    // The API returns { data: [...] } without pagination, so we wrap it
    const res = await this.request<{ data: ScanJob[] }>(`scan-jobs?limit=${limit}`);
    const data = res.data ?? [];
    return {
      data,
      pagination: {
        page,
        limit,
        total: data.length,
        totalPages: 1,
      },
    };
  }

  async triggerScan(sourceId: number): Promise<ScanJob> {
    return this.request('scan-jobs/run', {
      method: 'POST',
      body: JSON.stringify({ sourceId }),
    });
  }

  // ---- Analytics ----

  async getAnalyticsOverview(): Promise<AnalyticsOverview> {
    return this.request('analytics/overview');
  }

  async getYieldMetrics(): Promise<any> {
    return this.request('analytics/yield');
  }

  // ---- Canonical Leads (Inventory) ----

  async getCanonicalLeads(filters: Record<string, any> = {}): Promise<any> {
    const params = new URLSearchParams();
    for (const [key, val] of Object.entries(filters)) {
      if (val !== undefined && val !== null && val !== '') {
        params.set(key, String(val));
      }
    }
    return this.request(`canonical-leads?${params.toString()}`);
  }

  async getCanonicalLead(id: number): Promise<any> {
    return this.request(`canonical-leads/${id}`);
  }

  // ---- Inventory ----

  async getInventory(filters: Record<string, any> = {}): Promise<any> {
    const params = new URLSearchParams();
    for (const [key, val] of Object.entries(filters)) {
      if (val !== undefined && val !== null && val !== '') {
        params.set(key, String(val));
      }
    }
    return this.request(`inventory?${params.toString()}`);
  }

  async getInventoryStats(): Promise<any> {
    return this.request('inventory/stats');
  }

  async getInventoryPools(): Promise<any> {
    return this.request('inventory/pools');
  }

  // ---- Discovery ----
  // API routes: /api/discovery/query-runs, /api/discovery/trigger-scan

  async getDiscoveryQueryRuns(page = 1, limit = 25): Promise<any> {
    return this.request(`discovery/query-runs?page=${page}&limit=${limit}`);
  }

  async getSourceHealth(): Promise<any> {
    return this.requestData('discovery/source-health');
  }

  async triggerDiscoveryScan(sourceId?: number): Promise<any> {
    return this.request('discovery/trigger-scan', {
      method: 'POST',
      body: JSON.stringify({ sourceId }),
    });
  }

  // ---- Duplicates ----

  async getDuplicateCandidates(page = 1, limit = 25): Promise<any> {
    return this.request(`discovery/duplicates?page=${page}&limit=${limit}`);
  }

  async resolveDuplicate(id: number, resolution: string): Promise<any> {
    return this.request(`discovery/duplicates/${id}/resolve`, {
      method: 'POST',
      body: JSON.stringify({ resolution }),
    });
  }

  // ---- Campaigns ----

  async getCampaigns(filters: Record<string, any> = {}): Promise<any> {
    const params = new URLSearchParams();
    for (const [key, val] of Object.entries(filters)) {
      if (val !== undefined && val !== null && val !== '') {
        params.set(key, String(val));
      }
    }
    return this.request(`campaigns?${params.toString()}`);
  }

  async getCampaign(id: number): Promise<any> {
    return this.request(`campaigns/${id}`);
  }

  async assignToCampaign(data: {
    campaignName: string;
    canonicalLeadIds: number[];
  }): Promise<any> {
    return this.request('campaigns/assign', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  // ---- Tenant ----

  async getTenant(): Promise<any> {
    return this.request('tenant');
  }

  async getLeadTypes(): Promise<any> {
    return this.requestData('tenant/lead-types');
  }

  // ---- Pipeline ----

  async getPipelineLeads(): Promise<any> {
    return this.request('leads?sortBy=leadScore&sortOrder=desc&limit=50');
  }

  // ---- Inbox ----

  async getConversations(filters: Record<string, any> = {}): Promise<any> {
    const params = new URLSearchParams();
    for (const [key, val] of Object.entries(filters)) {
      if (val !== undefined && val !== null && val !== '') {
        params.set(key, String(val));
      }
    }
    return this.request(`inbox/conversations?${params.toString()}`);
  }

  async getConversationMessages(conversationId: number): Promise<any> {
    return this.request(`inbox/conversations/${conversationId}/messages`);
  }

  async sendReply(conversationId: number, body: string): Promise<any> {
    return this.request(`inbox/conversations/${conversationId}/reply`, {
      method: 'POST',
      body: JSON.stringify({ body }),
    });
  }

  async approveAiDraft(conversationId: number, draftId: number): Promise<any> {
    return this.request(`inbox/conversations/${conversationId}/drafts/${draftId}/approve`, {
      method: 'POST',
    });
  }
}

export class ApiError extends Error {
  constructor(message: string, public statusCode: number) {
    super(message);
    this.name = 'ApiError';
  }
}

export const api = new ApiClient();
