/**
 * Leads list - the top of the admissions funnel.
 *
 * Search plus status / source / course filters over GET /api/leads/ (the
 * filters the backend actually implements: `filters.py`), server-side
 * pagination from the envelope, and a "New lead" modal that surfaces the
 * server's per-field validation messages inline.
 *
 * The source picker is not hard-coded: sources come from the administrator
 * setting `SystemSettings.lead_sources` (GET /api/settings), merged with the
 * sources already present on the loaded leads so an older value stays
 * filterable.
 */

import { useCallback, useMemo, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Button,
  Card,
  Icon,
  Modal,
  SearchInput,
  Select,
  Table,
  TextField,
  type TableColumn,
} from '../../components';
import { useAuth } from '../../auth/AuthContext';
import { useSettings } from '../../settings/SettingsContext';
import { PERMISSIONS } from '../../types';
import { fieldErrors, generalErrorMessages, useAsyncResource, useReferenceData } from '../students/hooks';
import { FilterChips, InlineNote, RefreshButton, ServerPagination } from '../students/ui';
import {
  LEAD_STATUS_OPTIONS,
  crmApi,
  leadStatusLabel,
  mergeLeadSources,
  observedSources,
  type Lead,
  type LeadListParams,
  type LeadWritePayload,
} from './api';
import { LeadStatusBadge } from './widgets';

const DEFAULT_PAGE_SIZE = 25;

// --------------------------------------------------------------------------- //
// New lead
// --------------------------------------------------------------------------- //

interface LeadFormValues {
  full_name: string;
  phone: string;
  email: string;
  source: string;
  interested_course: number | '';
  notes: string;
}

const EMPTY_FORM: LeadFormValues = {
  full_name: '',
  phone: '',
  email: '',
  source: '',
  interested_course: '',
  notes: '',
};

function alertMessages(error: unknown, renderedFields: ReadonlyArray<string>): string[] {
  if (error === null || error === undefined) return [];
  const out = generalErrorMessages(error);
  const fields = fieldErrors(error);
  for (const [field, messages] of Object.entries(fields)) {
    if (renderedFields.includes(field)) continue;
    for (const message of messages) {
      if (!out.includes(message)) out.push(message);
    }
  }
  return out;
}

interface NewLeadModalProps {
  open: boolean;
  sources: ReadonlyArray<string>;
  courses: ReadonlyArray<{ id: number; name: string }>;
  onClose: () => void;
  onSaved: (lead: Lead) => void;
}

function NewLeadModal({ open, sources, courses, onClose, onSaved }: NewLeadModalProps) {
  const [values, setValues] = useState<LeadFormValues>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [localErrors, setLocalErrors] = useState<Record<string, string[]>>({});

  const set = <K extends keyof LeadFormValues>(key: K, value: LeadFormValues[K]): void => {
    setValues((current) => ({ ...current, [key]: value }));
  };

  const apiErrors = fieldErrors(error);
  const messagesFor = (field: string): string[] | undefined => {
    const remote = apiErrors[field];
    if (remote !== undefined && remote.length > 0) return remote;
    const local = localErrors[field];
    if (local !== undefined && local.length > 0) return local;
    return undefined;
  };

  const submit = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();

    const problems: Record<string, string[]> = {};
    if (values.full_name.trim() === '') problems.full_name = ['A lead needs a name.'];
    if (values.phone.trim() === '') problems.phone = ['A lead needs a phone number.'];
    if (Object.keys(problems).length > 0) {
      setLocalErrors(problems);
      return;
    }

    const payload: LeadWritePayload = {
      full_name: values.full_name.trim(),
      phone: values.phone.trim(),
    };
    if (values.email.trim() !== '') payload.email = values.email.trim();
    // The server validates `source` against the settings list, so only send it
    // when one was actually chosen.
    if (values.source !== '') payload.source = values.source;
    if (values.interested_course !== '') payload.interested_course = values.interested_course;
    if (values.notes.trim() !== '') payload.notes = values.notes.trim();

    setLocalErrors({});
    setSaving(true);
    setError(null);
    try {
      const saved = await crmApi.create(payload);
      setValues(EMPTY_FORM);
      onSaved(saved);
    } catch (cause) {
      setError(cause);
    } finally {
      setSaving(false);
    }
  };

  const generalMessages = alertMessages(error, [
    'full_name',
    'phone',
    'email',
    'source',
    'interested_course',
  ]);

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="lg"
      title="New lead"
      subtitle="Only a name and a phone number are required - everything else can follow."
      footer={
        <>
          <Button onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button type="submit" form="lead-create-form" variant="primary" loading={saving}>
            Create lead
          </Button>
        </>
      }
    >
      <form id="lead-create-form" className="u-stack" onSubmit={(event) => void submit(event)} noValidate>
        {generalMessages.length > 0 ? (
          <div className="alert alert--error" role="alert">
            <span className="alert__icon" aria-hidden="true">
              <Icon name="alertCircle" size={16} />
            </span>
            <div className="alert__content">
              {generalMessages.length === 1 ? (
                <span>{generalMessages[0]}</span>
              ) : (
                <ul className="alert__list">
                  {generalMessages.map((message) => (
                    <li key={message}>{message}</li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        ) : null}

        <div className="form-grid form-grid--two">
          <TextField
            label="Full name"
            value={values.full_name}
            onChange={(value) => set('full_name', value)}
            error={messagesFor('full_name')}
            required
            autoFocus
          />
          <TextField
            label="Phone"
            type="tel"
            value={values.phone}
            onChange={(value) => set('phone', value)}
            error={messagesFor('phone')}
            required
          />
          <TextField
            label="Email"
            type="email"
            value={values.email}
            onChange={(value) => set('email', value)}
            error={messagesFor('email')}
          />
          <Select<string>
            label="Source"
            options={sources.map((source) => ({ value: source, label: source }))}
            value={values.source}
            onChange={(value) => set('source', value)}
            placeholder="How did they find us?"
            error={messagesFor('source')}
            hint="Configured in settings, not in code."
          />
          <Select<number>
            label="Interested course"
            options={courses.map((course) => ({ value: course.id, label: course.name }))}
            value={values.interested_course}
            onChange={(value) => set('interested_course', value)}
            placeholder="Not decided yet"
            error={messagesFor('interested_course')}
          />
        </div>

        <div className="field">
          <label className="field__label" htmlFor="lead-create-notes">
            Notes
          </label>
          <textarea
            id="lead-create-notes"
            className="textarea"
            rows={3}
            value={values.notes}
            onChange={(event) => set('notes', event.target.value)}
          />
        </div>

        {/* Keeps Enter-to-submit working; the visible button lives in the footer. */}
        <button type="submit" className="visually-hidden" disabled={saving} tabIndex={-1}>
          Save
        </button>
      </form>
    </Modal>
  );
}

// --------------------------------------------------------------------------- //
// Page
// --------------------------------------------------------------------------- //

export interface LeadsListPageProps {
  /** Page heading. Defaults to "Leads". */
  title?: string;
  /**
   * Parameters applied to every request, which lock the page to a slice of the
   * pipeline. When supplied the page becomes a queue view: the status chips and
   * the "New lead" action are hidden, because the view is already scoped and
   * those controls would contradict it.
   *
   * This is how /trials (`has_trial`) and /admissions (`status_in`) reuse this
   * page instead of duplicating it.
   */
  baseParams?: Partial<LeadListParams>;
  emptyTitle?: string;
  emptyMessage?: string;
}

export function LeadsListPage({
  title = 'Leads',
  baseParams,
  emptyTitle = 'No leads found',
  emptyMessage,
}: LeadsListPageProps = {}) {
  const navigate = useNavigate();
  const settings = useSettings();
  const { hasPerm } = useAuth();
  const canManage = hasPerm(PERMISSIONS.LEADS_MANAGE);

  /** True when the view is a fixed slice of the pipeline rather than the browser. */
  const scoped = baseParams !== undefined;

  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [source, setSource] = useState('');
  const [course, setCourse] = useState<number | ''>('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState<number>(DEFAULT_PAGE_SIZE);
  const [formOpen, setFormOpen] = useState(false);

  const reference = useReferenceData();
  const courses = reference.data?.courses ?? [];

  const queryKey = [JSON.stringify(baseParams ?? {}), search, status, source, course, page, pageSize].join('|');

  const resource = useAsyncResource(
    () =>
      crmApi.list({
        ...baseParams,
        search: search.trim() === '' ? undefined : search.trim(),
        status: status === '' ? undefined : status,
        source: source === '' ? undefined : source,
        interested_course: course === '' ? undefined : course,
        ordering: '-created_at',
        page,
        page_size: pageSize,
      }),
    queryKey,
  );

  const rows = resource.data?.results ?? [];
  const count = resource.data?.count ?? 0;
  const totalPages = resource.data?.total_pages ?? 0;

  /** Any filter change restarts at page one (otherwise the page can be empty). */
  const resetToFirstPage = useCallback((): void => setPage(1), []);

  const sources = useMemo(
    () => mergeLeadSources(settings.settings.lead_sources, observedSources(rows)),
    [settings.settings.lead_sources, rows],
  );

  const columns = useMemo<ReadonlyArray<TableColumn<Lead>>>(
    () => [
      {
        key: 'name',
        header: 'Lead',
        render: (row) => (
          <span className="cell-stack">
            <span className="cell-stack__primary">{row.full_name}</span>
            {row.email !== '' ? (
              <span className="cell-stack__secondary">{row.email}</span>
            ) : null}
          </span>
        ),
      },
      {
        key: 'phone',
        header: 'Phone',
        width: '140px',
        render: (row) => <span className="u-nowrap">{row.phone || '—'}</span>,
      },
      {
        key: 'source',
        header: 'Source',
        width: '120px',
        render: (row) => row.source || <span className="u-subtle">—</span>,
      },
      {
        key: 'course',
        header: 'Course',
        render: (row) => row.interested_course_name || <span className="u-subtle">—</span>,
      },
      {
        key: 'status',
        header: 'Status',
        width: '150px',
        render: (row) => (
          <LeadStatusBadge status={row.status} label={leadStatusLabel(row.status, row.status_label)} />
        ),
      },
      {
        key: 'trial_date',
        header: 'Trial',
        width: '120px',
        render: (row) => <span className="u-nowrap">{settings.date(row.trial_date)}</span>,
      },
      {
        key: 'created_at',
        header: 'Created',
        width: '120px',
        render: (row) => <span className="u-nowrap">{settings.date(row.created_at)}</span>,
      },
    ],
    [settings],
  );

  const hasFilters =
    search.trim() !== '' || (!scoped && status !== '') || source !== '' || course !== '';

  const toolbar = (
    <div className="toolbar-split">
      <div className="filter-bar__field" style={{ minWidth: 240 }}>
        <SearchInput
          value={search}
          onChange={(value) => {
            setSearch(value);
            resetToFirstPage();
          }}
          placeholder="Name, phone or email"
          debounceMs={350}
        />
      </div>

      <Select<string>
        label="Source"
        labelHidden
        small
        placeholder="All sources"
        options={sources.map((entry) => ({ value: entry, label: entry }))}
        value={source}
        onChange={(value) => {
          setSource(value);
          resetToFirstPage();
        }}
      />

      <Select<number>
        label="Course"
        labelHidden
        small
        placeholder="All courses"
        options={courses.map((entry) => ({ value: entry.id, label: entry.name }))}
        value={course}
        onChange={(value) => {
          setCourse(value);
          resetToFirstPage();
        }}
      />

      <span className="toolbar-split__spacer" />

      {/* The status chips would contradict a view that is already scoped. */}
      {scoped ? null : (
        <FilterChips
          options={LEAD_STATUS_OPTIONS.map((option) => ({ value: option.value, label: option.label }))}
          value={status}
          onChange={(value) => {
            setStatus(value);
            resetToFirstPage();
          }}
          allLabel="Any status"
          label="Filter leads by status"
        />
      )}

      <RefreshButton onClick={resource.reload} label="Reload" />
    </div>
  );

  return (
    <div className="module-page">
      <header className="page-header">
        <div className="page-header__heading">
          <h1 className="page-header__title">{title}</h1>
          <p className="page-header__subtitle">
            {resource.loading
              ? 'Loading leads…'
              : `${settings.number(count)} ${count === 1 ? 'lead' : 'leads'} match the current filters.`}
          </p>
        </div>
        {canManage && !scoped ? (
          <div className="page-header__actions">
            <Button variant="primary" icon="plus" onClick={() => setFormOpen(true)}>
              New lead
            </Button>
          </div>
        ) : null}
      </header>

      <Card flush>
        <Table<Lead>
          columns={columns}
          rows={rows}
          rowKey={(row) => row.id}
          onRowClick={(row) => navigate(`/leads/${row.id}`)}
          loading={resource.loading}
          error={resource.error}
          onRetry={resource.reload}
          paginated={false}
          dense
          stickyHeader
          toolbar={toolbar}
          emptyIcon="crm"
          emptyTitle={emptyTitle}
          emptyMessage={
            emptyMessage ??
            (hasFilters
              ? 'Try clearing the search box or one of the filters.'
              : 'Leads you add will appear here, newest first.')
          }
          emptyAction={
            canManage && !hasFilters && !scoped ? (
              <Button variant="primary" icon="plus" onClick={() => setFormOpen(true)}>
                New lead
              </Button>
            ) : undefined
          }
          actions={(row) => (
            <Button
              size="sm"
              icon="eye"
              onClick={(event) => {
                event.stopPropagation();
                navigate(`/leads/${row.id}`);
              }}
            >
              Open
            </Button>
          )}
          actionsHeader={<Icon name="settings" size={14} />}
          caption="Leads"
          footer={
            <ServerPagination
              page={page}
              totalPages={totalPages}
              count={count}
              pageSize={pageSize}
              itemLabel="leads"
              onPageChange={setPage}
              onPageSizeChange={(size) => {
                setPageSize(size);
                resetToFirstPage();
              }}
            />
          }
        />
      </Card>

      {!canManage ? (
        <InlineNote>
          Your role can read the pipeline but not create or edit leads: the server requires
          <code> leads.manage </code> for that.
        </InlineNote>
      ) : null}

      <NewLeadModal
        open={formOpen}
        sources={sources}
        courses={courses.map((course) => ({ id: course.id, name: course.name }))}
        onClose={() => setFormOpen(false)}
        onSaved={(lead) => {
          setFormOpen(false);
          navigate(`/leads/${lead.id}`);
        }}
      />
    </div>
  );
}

export default LeadsListPage;
