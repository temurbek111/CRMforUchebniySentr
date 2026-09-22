/**
 * Global search (`GET /api/search?q=`).
 *
 * The backend returns every hit in one uniform shape so the UI can render any
 * group without knowing what it is:
 *
 *   { query: 'ali', total: 16, results: { students: [{id, label, sublabel, link}], ... } }
 *
 * The `link` is produced by the server and is the single source of truth for
 * where a hit lives, so the frontend never invents a route for a record.
 */

import { api } from '../../api/client';

export interface SearchHit {
  id: number;
  /** Primary line, e.g. "Ali Xolmatov" or "PAY-000270 · 1100000.00". */
  label: string;
  /** Secondary line, e.g. "STU-0036 · active". */
  sublabel: string;
  /** In-app path for the record, e.g. "/students/36". */
  link: string;
}

export interface SearchResponse {
  query: string;
  total: number;
  /** Keyed by entity name; only groups with matches are present. */
  results: Record<string, SearchHit[]>;
}

export function searchEverything(query: string): Promise<SearchResponse> {
  return api.get<SearchResponse>('/api/search', { params: { q: query } });
}
