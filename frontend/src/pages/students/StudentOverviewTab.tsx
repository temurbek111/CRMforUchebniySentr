/**
 * Student profile - Overview tab.
 *
 * One request to GET /api/students/{id}/overview/ returns the headline numbers
 * (fee, balance, attendance, exams) plus the current group, so the panel needs
 * a single loading/error/empty cycle.
 */

import { Card, EmptyState, StatCard, StatusBadge } from '../../components';
import { useSettings } from '../../settings/SettingsContext';
import { studentsApi, toNumber, type StudentOverview } from './api';
import { useAsyncResource } from './hooks';
import { AsyncSection, DataField, RecordLink, TrendBadge } from './ui';

export interface StudentOverviewTabProps {
  studentId: number;
  onOpenGroup: (groupId: number) => void;
}

export function StudentOverviewTab({ studentId, onOpenGroup }: StudentOverviewTabProps) {
  const resource = useAsyncResource(() => studentsApi.overview(studentId), `overview:${studentId}`);
  const data = resource.data;

  return (
    <AsyncSection
      loading={resource.loading}
      error={resource.error}
      onRetry={resource.reload}
      loadingRows={4}
    >
      {data === null ? null : (
        <StudentOverviewContent data={data} onOpenGroup={onOpenGroup} />
      )}
    </AsyncSection>
  );
}

function StudentOverviewContent({
  data,
  onOpenGroup,
}: {
  data: StudentOverview;
  onOpenGroup: (groupId: number) => void;
}) {
  const settings = useSettings();
  const group = data.group;

  return (
    <div className="section-stack">
      <div className="kpi-grid">
        <StatCard
          label="Monthly fee"
          icon="wallet"
          value={settings.money(toNumber(data.monthly_fee))}
          hint="After any override"
        />
        <StatCard
          label="Outstanding balance"
          icon="finance"
          value={settings.money(toNumber(data.outstanding_balance))}
          footer={<StatusBadge status={data.payment_status} />}
        />
        <StatCard
          label="Attendance"
          icon="calendar"
          value={settings.percent(toNumber(data.attendance_pct), 1)}
          hint="Present + late over every marked session"
        />
        <StatCard
          label="Exam average"
          icon="chartLine"
          value={settings.percent(toNumber(data.exam_average_pct), 1)}
          footer={<TrendBadge trend={data.performance_trend} />}
        />
        <StatCard
          label="Latest exam score"
          icon="reports"
          value={data.latest_exam_score === null ? '—' : data.latest_exam_score}
        />
      </div>

      <Card
        title="Current group"
        subtitle="The membership that is currently open for this student."
        actions={
          group !== null ? (
            <button type="button" className="row-link" onClick={() => onOpenGroup(group.id)}>
              Open group
            </button>
          ) : undefined
        }
      >
        {group === null ? (
          <EmptyState
            icon="users"
            title="Not enrolled in a group"
            message="Enrol the student into a group to see their schedule, attendance and billing here."
          />
        ) : (
          <div className="meta-grid">
            <DataField label="Group">
              <RecordLink to={`/groups/${group.id}`}>{group.name}</RecordLink>
            </DataField>
            <DataField label="Course">{group.course || '—'}</DataField>
            <DataField label="Teacher">{group.teacher || '—'}</DataField>
            <DataField label="Room">{group.room || '—'}</DataField>
            <DataField label="Schedule">{group.schedule || '—'}</DataField>
            <DataField label="Joined">{settings.date(group.joined_at)}</DataField>
          </div>
        )}
      </Card>
    </div>
  );
}

export default StudentOverviewTab;
