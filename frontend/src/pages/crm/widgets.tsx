/**
 * Presentational pieces shared by the CRM pages.
 *
 * Same discipline as the rest of the app: these compose the existing component
 * library (Badge, StatCard, Card) and the students module's AsyncSection, and
 * they never invent data - every number comes from GET /api/leads/pipeline/ or
 * from the lead row the server sent.
 */

import { Badge, Button, StatCard, type BadgeTone } from '../../components';
import { useSettings } from '../../settings/SettingsContext';
import { toNumber } from '../students/api';
import { AsyncSection } from '../students/ui';
import type { LeadPipeline } from './api';

// --------------------------------------------------------------------------- //
// Status badge
// --------------------------------------------------------------------------- //

/**
 * Tone per `LeadStatus`. The generic `StatusBadge` map in components/Badge.tsx
 * does not know the CRM vocabulary (it would paint `registered` grey and
 * `trial_scheduled` grey too), so the pipeline gets its own mapping - the
 * colour always means the same thing here:
 *
 *   new/contacted    - in play, nothing booked yet
 *   trial_*          - a trial is the current step
 *   interested       - a decision is pending
 *   registered       - won (converted)
 *   lost             - closed, not converted
 */
const STATUS_TONES: Record<string, BadgeTone> = {
  new: 'info',
  contacted: 'primary',
  trial_scheduled: 'primary',
  trial_completed: 'warning',
  interested: 'warning',
  registered: 'success',
  lost: 'danger',
};

export function leadStatusTone(status: string): BadgeTone {
  return STATUS_TONES[status] ?? 'neutral';
}

export function LeadStatusBadge({
  status,
  label,
}: {
  status: string;
  label?: string;
}) {
  return (
    <Badge tone={leadStatusTone(status)} dot>
      {(label ?? '').trim() !== '' ? label : status.replace(/_/g, ' ')}
    </Badge>
  );
}

// --------------------------------------------------------------------------- //
// Pipeline strip
// --------------------------------------------------------------------------- //

export interface PipelineStripProps {
  pipeline: LeadPipeline | null;
  loading: boolean;
  error: unknown;
  onRetry: () => void;
  title?: string;
  subtitle?: string;
}

/**
 * The funnel summary from GET /api/leads/pipeline/.
 *
 * `conversion_rate` is a JSON number (the API serves decimals as numbers), and
 * it is already in percent units - so it is rendered with the settings-aware
 * percent formatter, never hand-formatted.
 */
export function PipelineStrip({
  pipeline,
  loading,
  error,
  onRetry,
  title = 'Pipeline',
  subtitle,
}: PipelineStripProps) {
  const settings = useSettings();
  const rate = toNumber(pipeline?.conversion_rate ?? null);

  const tiles: ReadonlyArray<{ label: string; value: number; icon: string }> = [
    { label: 'Leads', value: pipeline?.new_leads ?? 0, icon: 'crm' },
    { label: 'Contacted', value: pipeline?.contacted ?? 0, icon: 'user' },
    { label: 'Trials scheduled', value: pipeline?.trials_scheduled ?? 0, icon: 'calendar' },
    { label: 'Trials completed', value: pipeline?.trials_completed ?? 0, icon: 'checkCircle' },
    { label: 'Interested', value: pipeline?.interested ?? 0, icon: 'info' },
    { label: 'Registered', value: pipeline?.registered ?? 0, icon: 'students' },
    { label: 'Lost', value: pipeline?.lost ?? 0, icon: 'close' },
  ];

  return (
    <section className="section-stack section-stack--tight" aria-label={title}>
      <div className="u-row u-row--between">
        <div>
          <h2 className="card__title">{title}</h2>
          {subtitle !== undefined ? <p className="card__subtitle">{subtitle}</p> : null}
        </div>
        <Button size="sm" icon="refresh" onClick={onRetry}>
          Reload
        </Button>
      </div>

      <AsyncSection
        loading={loading}
        error={error}
        onRetry={onRetry}
        inline
        loadingLabel="Loading pipeline…"
      >
        <div className="kpi-grid">
          {tiles.map((tile) => (
            <StatCard
              key={tile.label}
              label={tile.label}
              value={settings.number(tile.value)}
              icon={tile.icon}
            />
          ))}
          <StatCard
            label="Conversion rate"
            value={settings.percent(rate, 2)}
            icon="chartBar"
            hint={`${settings.number(pipeline?.registered ?? 0)} of ${settings.number(
              pipeline?.new_leads ?? 0,
            )} leads registered`}
          />
        </div>
      </AsyncSection>
    </section>
  );
}

export default PipelineStrip;
