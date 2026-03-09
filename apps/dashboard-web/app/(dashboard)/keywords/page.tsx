'use client';

import { useCallback, useEffect, useState } from 'react';
import type { KeywordCategory, Keyword } from '@alh/types';
import { api } from '@/lib/api-client';
import { cn } from '@/lib/utils';

export default function KeywordsPage() {
  const [categories, setCategories] = useState<KeywordCategory[]>([]);
  const [keywords, setKeywords] = useState<Keyword[]>([]);
  const [selectedCategory, setSelectedCategory] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [newKeyword, setNewKeyword] = useState('');
  const [newType, setNewType] = useState<string>('phrase');

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const [cats, kws] = await Promise.all([
        api.getKeywordCategories(),
        api.getKeywords(selectedCategory ?? undefined),
      ]);
      setCategories(cats);
      setKeywords(kws);
    } catch (err) {
      console.error('Failed to fetch keywords:', err);
    } finally {
      setLoading(false);
    }
  }, [selectedCategory]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  async function handleAdd() {
    if (!newKeyword.trim() || !selectedCategory) return;
    try {
      const kw = await api.createKeyword({
        categoryId: selectedCategory,
        keyword: newKeyword.trim(),
        keywordType: newType,
      });
      setKeywords((prev) => [kw, ...prev]);
      setNewKeyword('');
    } catch (err) {
      console.error('Failed to create keyword:', err);
    }
  }

  async function handleToggle(kw: Keyword) {
    try {
      const updated = await api.toggleKeyword(kw.id, !kw.isActive);
      setKeywords((prev) => prev.map((k) => (k.id === kw.id ? updated : k)));
    } catch (err) {
      console.error('Failed to toggle keyword:', err);
    }
  }

  async function handleDelete(id: number) {
    try {
      await api.deleteKeyword(id);
      setKeywords((prev) => prev.filter((k) => k.id !== id));
    } catch (err) {
      console.error('Failed to delete keyword:', err);
    }
  }

  const filteredKeywords = selectedCategory
    ? keywords.filter((k) => k.categoryId === selectedCategory)
    : keywords;

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-lg font-semibold text-text-primary">Keywords</h1>
        <p className="text-sm text-text-muted mt-0.5">
          Manage keyword groups that drive lead discovery
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
        {/* Category List */}
        <div className="bg-surface-raised border border-border rounded-lg p-4">
          <h2 className="text-xs font-medium text-text-muted uppercase tracking-wider mb-3">
            Categories
          </h2>
          <div className="space-y-1">
            <button
              onClick={() => setSelectedCategory(null)}
              className={cn(
                'w-full text-left px-3 py-2 rounded-md text-sm transition-colors',
                selectedCategory === null
                  ? 'bg-accent/10 text-accent'
                  : 'text-text-secondary hover:bg-surface-overlay'
              )}
            >
              All Keywords
            </button>
            {categories.map((cat) => (
              <button
                key={cat.id}
                onClick={() => setSelectedCategory(cat.id)}
                className={cn(
                  'w-full text-left px-3 py-2 rounded-md text-sm transition-colors flex items-center justify-between',
                  selectedCategory === cat.id
                    ? 'bg-accent/10 text-accent'
                    : 'text-text-secondary hover:bg-surface-overlay'
                )}
              >
                <span>{cat.name}</span>
                {!cat.isActive && (
                  <span className="text-[10px] text-text-muted">OFF</span>
                )}
              </button>
            ))}
          </div>
        </div>

        {/* Keywords */}
        <div className="lg:col-span-3 space-y-4">
          {/* Add keyword form */}
          {selectedCategory && (
            <div className="flex items-center gap-3">
              <input
                type="text"
                placeholder="Add keyword..."
                value={newKeyword}
                onChange={(e) => setNewKeyword(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleAdd()}
                className="flex-1 bg-surface-raised border border-border rounded-md px-3 py-2 text-sm text-text-primary placeholder:text-text-muted focus:border-accent focus:ring-1 focus:ring-accent"
              />
              <select
                value={newType}
                onChange={(e) => setNewType(e.target.value)}
                className="bg-surface-raised border border-border rounded-md px-3 py-2 text-sm text-text-primary"
              >
                <option value="phrase">Phrase</option>
                <option value="hashtag">Hashtag</option>
                <option value="regex">Regex</option>
              </select>
              <button
                onClick={handleAdd}
                disabled={!newKeyword.trim()}
                className="px-4 py-2 text-sm font-medium rounded-md bg-accent text-white hover:bg-accent-hover disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              >
                Add
              </button>
            </div>
          )}

          {/* Keyword list */}
          <div className="bg-surface-raised border border-border rounded-lg overflow-hidden">
            {filteredKeywords.length === 0 ? (
              <div className="p-8 text-center text-sm text-text-muted">
                {selectedCategory ? 'No keywords in this category' : 'Select a category to manage keywords'}
              </div>
            ) : (
              <div className="divide-y divide-border-subtle">
                {filteredKeywords.map((kw) => (
                  <div key={kw.id} className="flex items-center justify-between px-4 py-3">
                    <div className="flex items-center gap-3">
                      <button
                        onClick={() => handleToggle(kw)}
                        className={cn(
                          'w-8 h-4 rounded-full relative transition-colors',
                          kw.isActive ? 'bg-accent' : 'bg-border'
                        )}
                      >
                        <span
                          className={cn(
                            'absolute top-0.5 w-3 h-3 rounded-full bg-white transition-transform',
                            kw.isActive ? 'left-4' : 'left-0.5'
                          )}
                        />
                      </button>
                      <span className={cn(
                        'text-sm',
                        kw.isActive ? 'text-text-primary' : 'text-text-muted line-through'
                      )}>
                        {kw.keyword}
                      </span>
                      <span className="text-[10px] text-text-muted uppercase px-1.5 py-0.5 rounded bg-surface-overlay border border-border">
                        {kw.keywordType}
                      </span>
                    </div>
                    <div className="flex items-center gap-3">
                      <span className="text-xs text-text-muted tabular-nums">
                        {kw.matchCount} matches
                      </span>
                      <button
                        onClick={() => handleDelete(kw.id)}
                        className="text-xs text-text-muted hover:text-danger transition-colors"
                      >
                        Delete
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
