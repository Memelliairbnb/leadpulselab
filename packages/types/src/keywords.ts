export interface KeywordCategory {
  id: number;
  tenantId: number;
  name: string;
  description: string | null;
  isActive: boolean;
  createdAt: Date;
}

export interface Keyword {
  id: number;
  tenantId: number;
  categoryId: number;
  keyword: string;
  keywordType: KeywordType;
  isActive: boolean;
  matchCount: number;
  createdAt: Date;
}

export type KeywordType = 'phrase' | 'hashtag' | 'regex';
