'use client';

import { useCallback, useState } from 'react';
import Link from 'next/link';

interface CsvRow {
  fullName: string;
  email: string;
  phone: string;
  platform: string;
  sourceUrl: string;
  rawText: string;
  notes: string;
}

interface ImportResult {
  row: number;
  success: boolean;
  error?: string;
}

function parseCsv(text: string): CsvRow[] {
  const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);
  if (lines.length < 2) return [];

  // Parse header
  const header = parseCsvLine(lines[0]).map((h) => h.toLowerCase().trim());

  // Map column names to our field names
  const fieldMap: Record<string, keyof CsvRow> = {
    name: 'fullName',
    full_name: 'fullName',
    fullname: 'fullName',
    'full name': 'fullName',
    email: 'email',
    phone: 'phone',
    platform: 'platform',
    source_url: 'sourceUrl',
    sourceurl: 'sourceUrl',
    'source url': 'sourceUrl',
    raw_text: 'rawText',
    rawtext: 'rawText',
    'raw text': 'rawText',
    text: 'rawText',
    notes: 'notes',
    note: 'notes',
  };

  const columnMapping = header.map((h) => fieldMap[h] || null);

  const rows: CsvRow[] = [];
  for (let i = 1; i < lines.length; i++) {
    const values = parseCsvLine(lines[i]);
    const row: CsvRow = {
      fullName: '',
      email: '',
      phone: '',
      platform: 'manual',
      sourceUrl: '',
      rawText: '',
      notes: '',
    };

    for (let j = 0; j < values.length; j++) {
      const field = columnMapping[j];
      if (field) {
        row[field] = values[j].trim();
      }
    }

    // Skip completely empty rows
    if (row.fullName || row.email || row.rawText) {
      rows.push(row);
    }
  }

  return rows;
}

function parseCsvLine(line: string): string[] {
  const result: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"' && line[i + 1] === '"') {
        current += '"';
        i++;
      } else if (ch === '"') {
        inQuotes = false;
      } else {
        current += ch;
      }
    } else {
      if (ch === '"') {
        inQuotes = true;
      } else if (ch === ',') {
        result.push(current);
        current = '';
      } else {
        current += ch;
      }
    }
  }
  result.push(current);
  return result;
}

export default function ImportLeadsPage() {
  const [rows, setRows] = useState<CsvRow[]>([]);
  const [fileName, setFileName] = useState<string>('');
  const [importing, setImporting] = useState(false);
  const [progress, setProgress] = useState(0);
  const [results, setResults] = useState<ImportResult[]>([]);
  const [done, setDone] = useState(false);
  const [parseError, setParseError] = useState<string | null>(null);

  const handleFile = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setParseError(null);
    setFileName(file.name);
    setResults([]);
    setDone(false);
    setProgress(0);

    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const text = ev.target?.result as string;
        const parsed = parseCsv(text);
        if (parsed.length === 0) {
          setParseError('No valid rows found. Make sure the CSV has a header row with columns like: name, email, phone, platform, source_url, raw_text, notes');
          setRows([]);
          return;
        }
        setRows(parsed);
      } catch {
        setParseError('Failed to parse CSV file');
        setRows([]);
      }
    };
    reader.readAsText(file);
  }, []);

  async function handleImport() {
    setImporting(true);
    setProgress(0);
    setResults([]);
    setDone(false);

    const importResults: ImportResult[] = [];

    for (let i = 0; i < rows.length; i++) {
      try {
        const res = await fetch('/api/proxy/leads/manual', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(rows[i]),
        });

        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          importResults.push({ row: i + 1, success: false, error: body.message || `HTTP ${res.status}` });
        } else {
          importResults.push({ row: i + 1, success: true });
        }
      } catch (err: any) {
        importResults.push({ row: i + 1, success: false, error: err.message || 'Network error' });
      }

      setProgress(i + 1);
      setResults([...importResults]);
    }

    setDone(true);
    setImporting(false);
  }

  const successCount = results.filter((r) => r.success).length;
  const failCount = results.filter((r) => !r.success).length;
  const progressPct = rows.length > 0 ? Math.round((progress / rows.length) * 100) : 0;

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold text-text-primary">Import Leads</h1>
          <p className="text-sm text-text-muted mt-0.5">
            Upload a CSV file to bulk-import leads for AI analysis
          </p>
        </div>
        <Link
          href="/leads"
          className="text-sm text-text-muted hover:text-text-primary transition-colors"
        >
          Back to Leads
        </Link>
      </div>

      {/* Upload area */}
      <div className="bg-surface-raised border border-border rounded-lg p-6">
        <div className="space-y-4">
          <div>
            <label className="block text-xs font-medium text-text-secondary mb-1.5">
              CSV File
            </label>
            <input
              type="file"
              accept=".csv,text/csv"
              onChange={handleFile}
              disabled={importing}
              className="block w-full text-sm text-text-muted file:mr-4 file:py-2 file:px-4 file:rounded-md file:border-0 file:text-sm file:font-medium file:bg-accent file:text-white file:cursor-pointer hover:file:bg-accent-hover disabled:opacity-50"
            />
            <p className="text-xs text-text-muted mt-2">
              Expected columns: name, email, phone, platform, source_url, raw_text, notes
            </p>
          </div>

          {parseError && (
            <div className="bg-red-900/20 border border-red-700/30 rounded-md px-4 py-3 text-sm text-red-400">
              {parseError}
            </div>
          )}
        </div>
      </div>

      {/* Preview table */}
      {rows.length > 0 && !done && (
        <div className="bg-surface-raised border border-border rounded-lg overflow-hidden">
          <div className="px-5 py-3 border-b border-border flex items-center justify-between">
            <div className="text-sm text-text-secondary">
              <span className="text-text-primary font-medium">{rows.length}</span> rows from{' '}
              <span className="text-text-primary">{fileName}</span>
            </div>
            <button
              onClick={handleImport}
              disabled={importing}
              className="px-4 py-1.5 bg-accent hover:bg-accent-hover text-white text-sm font-medium rounded-md transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {importing ? 'Importing...' : `Import ${rows.length} Leads`}
            </button>
          </div>

          {/* Progress bar */}
          {importing && (
            <div className="px-5 py-3 border-b border-border">
              <div className="flex items-center justify-between text-xs text-text-muted mb-1.5">
                <span>Importing... {progress} of {rows.length}</span>
                <span>{progressPct}%</span>
              </div>
              <div className="w-full bg-surface-overlay rounded-full h-2">
                <div
                  className="bg-accent h-2 rounded-full transition-all duration-300"
                  style={{ width: `${progressPct}%` }}
                />
              </div>
            </div>
          )}

          <div className="overflow-x-auto max-h-96 overflow-y-auto">
            <table className="w-full text-sm">
              <thead className="bg-surface-overlay sticky top-0">
                <tr>
                  <th className="text-left px-4 py-2 text-xs font-medium text-text-muted">#</th>
                  <th className="text-left px-4 py-2 text-xs font-medium text-text-muted">Name</th>
                  <th className="text-left px-4 py-2 text-xs font-medium text-text-muted">Email</th>
                  <th className="text-left px-4 py-2 text-xs font-medium text-text-muted">Phone</th>
                  <th className="text-left px-4 py-2 text-xs font-medium text-text-muted">Platform</th>
                  <th className="text-left px-4 py-2 text-xs font-medium text-text-muted">Text</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {rows.slice(0, 50).map((row, i) => (
                  <tr key={i} className="hover:bg-surface-overlay/50">
                    <td className="px-4 py-2 text-text-muted">{i + 1}</td>
                    <td className="px-4 py-2 text-text-primary">{row.fullName || '-'}</td>
                    <td className="px-4 py-2 text-text-secondary">{row.email || '-'}</td>
                    <td className="px-4 py-2 text-text-secondary">{row.phone || '-'}</td>
                    <td className="px-4 py-2 text-text-secondary capitalize">{row.platform || 'manual'}</td>
                    <td className="px-4 py-2 text-text-muted max-w-xs truncate">{row.rawText || '-'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {rows.length > 50 && (
              <div className="px-4 py-2 text-xs text-text-muted border-t border-border">
                Showing first 50 of {rows.length} rows
              </div>
            )}
          </div>
        </div>
      )}

      {/* Results summary */}
      {done && (
        <div className="bg-surface-raised border border-border rounded-lg p-6 space-y-4">
          <h2 className="text-sm font-semibold text-text-primary">Import Complete</h2>

          <div className="flex gap-6">
            <div className="text-center">
              <div className="text-2xl font-bold text-green-400">{successCount}</div>
              <div className="text-xs text-text-muted">Imported</div>
            </div>
            <div className="text-center">
              <div className="text-2xl font-bold text-red-400">{failCount}</div>
              <div className="text-xs text-text-muted">Failed</div>
            </div>
            <div className="text-center">
              <div className="text-2xl font-bold text-text-primary">{rows.length}</div>
              <div className="text-xs text-text-muted">Total</div>
            </div>
          </div>

          {failCount > 0 && (
            <div className="space-y-1">
              <p className="text-xs font-medium text-text-secondary">Failed rows:</p>
              {results
                .filter((r) => !r.success)
                .slice(0, 20)
                .map((r) => (
                  <div key={r.row} className="text-xs text-red-400">
                    Row {r.row}: {r.error}
                  </div>
                ))}
            </div>
          )}

          <div className="flex gap-3 pt-2">
            <Link
              href="/leads"
              className="px-4 py-2 bg-accent hover:bg-accent-hover text-white text-sm font-medium rounded-md transition-colors"
            >
              View Leads
            </Link>
            <button
              onClick={() => {
                setRows([]);
                setResults([]);
                setDone(false);
                setFileName('');
                setProgress(0);
              }}
              className="px-4 py-2 text-sm text-text-secondary hover:text-text-primary transition-colors"
            >
              Import More
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
