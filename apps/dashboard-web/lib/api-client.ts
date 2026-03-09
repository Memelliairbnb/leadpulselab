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

  async getLeadContacts(id: number): Promise<LeadContact[]> {
    return this.request(`leads/${id}/contacts`);
  }

  async getLeadActivity(id: number): Promise<LeadActivity[]> {
    return this.request(`leads/${id}/activity`);
  }

  async getLeadOutreach(id: number): Promise<OutreachDraft[]> {
    return this.request(`leads/${id}/outreach`);
  }

  async updateLeadStatus(id: number, status: string): Promise<QualifiedLead> {
    return this.request(`leads/${id}/status`, {
      method: 'PATCH',
      body: JSON.stringify({ status }),
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
    return this.request('sources');
  }

  async toggleSource(id: number, enabled: boolean): Promise<PlatformSource> {
    return this.request(`sources/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({ isEnabled: enabled }),
    });
  }

  // ---- Keywords ----

  async getKeywordCategories(): Promise<KeywordCategory[]> {
    return this.request('keywords/categories');
  }

  async getKeywords(categoryId?: number): Promise<Keyword[]> {
    const params = categoryId ? `?categoryId=${categoryId}` : '';
    return this.request(`keywords${params}`);
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

  async getScanJobs(page = 1, limit = 25): Promise<PaginatedResponse<ScanJob>> {
    return this.request(`scans?page=${page}&limit=${limit}`);
  }

  async triggerScan(sourceId: number): Promise<ScanJob> {
    return this.request('scans', {
      method: 'POST',
      body: JSON.stringify({ sourceId }),
    });
  }

  // ---- Analytics ----

  async getAnalyticsOverview(): Promise<AnalyticsOverview> {
    return this.request('analytics/overview');
  }
}

export class ApiError extends Error {
  constructor(message: string, public statusCode: number) {
    super(message);
    this.name = 'ApiError';
  }
}

export const api = new ApiClient();
