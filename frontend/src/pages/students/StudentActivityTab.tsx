/**
 * Student profile - Activity tab.
 *
 * GET /api/students/{id}/activity/ merges enrolments, payments and the audit
 * trail into one server-sorted timeline. The dot colour is derived from the
 * event `kind`; nothing is invented locally.
 */

import { useMemo } from 'react';
import { Card } from '../../components';
import { useSettings } from '../../settings/SettingsContext';
import { studentsApi, type ActivityEvent } from './api';
import { useAsyncResource } from './hooks';
import { AsyncSection } from './ui';

export interface StudentActivityTabProps {
  studentId: number;
}

type DotTone = 'success' | 'warning' | 'danger' | 'info' | 'default';

function toneForKind(kind: string): DotTone {
  if (kind.startsWith('audit:delete')) return 'danger';
  if (kind.startsWith('audit:void')) return 'danger';
  if (kind.startsWith('audit:update')) return 'info';
  if (kind.startsWith('audit:create')) return 'success';
  if (kind === 'payment') return 'success';
  if (kind === 'enrollment') return 'success';
  if (kind === 'membership_ended') return 'warning';
  return 'default';
}

function labelForKind(kind: string): string {
  if (kind.startsWith('audit:')) return `audit · ${kind.slice('audit:'.length)}`;
  return kind.replace(/_/g, ' ');
}

export function StudentActivityTab({ studentId }: StudentActivityTabProps) {
  const settings = useSettings();
  const resource = useAsyncResource(
    () => studentsApi.activity(studentId),
    `activity:${studentId}`,
  );
  const events = useMemo<ActivityEvent[]>(() => resource.data?.results ?? [], [resource.data]);

  return (
    <Card title="Activity" subtitle="Enrolments, payments and audit entries in one timeline.">
      <AsyncSection
        loading={resource.loading}
        error={resource.error}
        onRetry={resource.reload}
        isEmpty={events.length === 0}
        emptyIcon="clipboard"
        emptyTitle="No activity recorded"
        emptyMessage="Enrolments, payments and edits will show up here as they happen."
        loadingRows={5}
      >
        <ol className="timeline">
          {events.map((event, index) => {
            const tone = toneForKind(event.kind);
            return (
              <li className="timeline__item" key={`${event.kind}-${event.at ?? 'unknown'}-${index}`}>
                <span
                  className={[
                    'timeline__dot',
                    tone === 'default' ? '' : `timeline__dot--${tone}`,
                  ]
                    .filter(Boolean)
                    .join(' ')}
                  aria-hidden="true"
                />
                <div className="timeline__body">
                  <span className="timeline__title">{event.title}</span>
                  {event.detail ? <span className="timeline__detail">{event.detail}</span> : null}
                  <span className="timeline__meta">
                    {labelForKind(event.kind)} · {settings.dateTime(event.at)}
                  </span>
                </div>
              </li>
            );
          })}
        </ol>
      </AsyncSection>
    </Card>
  );
}

export default StudentActivityTab;
