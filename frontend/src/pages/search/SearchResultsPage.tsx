/**
 * Global search results.
 *
 * The topbar search box announces a query on the `lcrm:global-search` event;
 * <AppLayout> answers it by navigating here, so the query is shareable and
 * survives a refresh. Results come from `/api/search` and are grouped by entity
 * with the ordering and labels declared below — the server decides *what*
 * matches, this page decides how it is presented.
 */

import { useCallback, useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Button, Card, EmptyState, ErrorState, LoadingState } from '../../components';
import { searchEverything, type SearchResponse } from './searchApi';

/** Presentation order; groups the server did not return are simply skipped. */
const GROUP_ORDER = ['students', 'teachers', 'leads', 'payments'] as const;

const GROUP_LABELS: Record<string, string> = {
  students: 'Students',
  teachers: 'Teachers',
  leads: 'Leads',
  payments: 'Payments',
};

const GROUP_HINTS: Record<string, string> = {
  students: 'Name, code or phone',
  teachers: 'Name, specialisation or phone',
  leads: 'Name, phone or notes',
  payments: 'Receipt number or amount',
};

interface SearchState {
  loading: boolean;
  error: unknown;
  data: SearchResponse | null;
}

export function SearchResultsPage() {
  const [params, setParams] = useSearchParams();
  const query = (params.get('q') ?? '').trim();
  const [term, setTerm] = useState(query);
  const [state, setState] = useState<SearchState>({ loading: false, error: null, data: null });

  const run = useCallback(async (value: string): Promise<void> => {
    if (value === '') {
      setState({ loading: false, error: null, data: null });
      return;
    }
    setState({ loading: true, error: null, data: null });
    try {
      const data = await searchEverything(value);
      setState({ loading: false, error: null, data });
    } catch (error) {
      setState({ loading: false, error, data: null });
    }
  }, []);

  useEffect(() => {
    setTerm(query);
    void run(query);
  }, [query, run]);

  const submit = (event: React.FormEvent): void => {
    event.preventDefault();
    const next = term.trim();
    setParams(next === '' ? {} : { q: next });
  };

  const groups = state.data === null
    ? []
    : GROUP_ORDER
        .filter((key) => (state.data?.results[key]?.length ?? 0) > 0)
        .map((key) => ({ key, hits: state.data?.results[key] ?? [] }));

  return (
    <>
      <header className="page-header">
        <div className="page-header__heading">
          <h1 className="page-header__title">Search</h1>
          <p className="page-header__subtitle">
            {query === ''
              ? 'Find a student, teacher, lead or payment receipt. Use the box in the top bar from any page.'
              : `${state.data?.total ?? 0} result${(state.data?.total ?? 0) === 1 ? '' : 's'} for “${query}”.`}
          </p>
        </div>
      </header>

      <Card>
        <form className="u-stack" onSubmit={submit} role="search" style={{ marginBottom: 16 }}>
          <label className="field" style={{ maxWidth: 420 }}>
            <span className="field__label">Search the centre</span>
            <input
              className="input"
              type="search"
              name="q"
              value={term}
              placeholder="Name, phone, code or receipt number…"
              onChange={(event) => setTerm(event.target.value)}
            />
          </label>
          <div className="u-row">
            <Button variant="primary" type="submit" icon="search">
              Search
            </Button>
            {query !== '' ? (
              <Button
                type="button"
                onClick={() => {
                  setTerm('');
                  setParams({});
                }}
              >
                Clear
              </Button>
            ) : null}
          </div>
        </form>
      </Card>

      {state.loading ? <LoadingState label="Searching…" /> : null}

      {state.error !== null ? (
        <ErrorState error={state.error} onRetry={() => void run(query)} />
      ) : null}

      {!state.loading && state.error === null && query !== '' && groups.length === 0 ? (
        <EmptyState
          title={`Nothing matches “${query}”`}
          message="Try a shorter term, a phone number, or a student code such as STU-0036."
          icon="search"
        />
      ) : null}

      {!state.loading && state.error === null && query === '' ? (
        <EmptyState
          title="Type something to search"
          message="Searching covers students, teachers, leads and payment receipts."
          icon="search"
        />
      ) : null}

      {groups.map((group) => (
        <Card
          key={group.key}
          title={`${GROUP_LABELS[group.key] ?? group.key} · ${group.hits.length}`}
        >
          <p className="u-muted" style={{ marginTop: 0 }}>
            {GROUP_HINTS[group.key] ?? ''}
          </p>
          <ul className="search-hits">
            {group.hits.map((hit) => (
              <li key={`${group.key}-${hit.id}`} className="search-hits__item">
                <Link className="search-hits__link" to={hit.link}>
                  <span className="search-hits__label">{hit.label}</span>
                  {hit.sublabel !== '' ? (
                    <span className="search-hits__sublabel">{hit.sublabel}</span>
                  ) : null}
                </Link>
              </li>
            ))}
          </ul>
        </Card>
      ))}
    </>
  );
}
