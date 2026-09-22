/**
 * Student profile - Notes tab.
 *
 * GET/POST /api/students/{id}/notes/ and the audited
 * POST /api/students/{id}/notes/{noteId}/delete/. Both writes require
 * `students.manage`; the server enforces it, the UI only hides the controls.
 */

import { useState, type FormEvent } from 'react';
import { Badge, Button, Card, ConfirmDialog, Icon } from '../../components';
import { useAuth } from '../../auth/AuthContext';
import { useSettings } from '../../settings/SettingsContext';
import { studentsApi, type StudentNote } from './api';
import { generalErrorMessages, useAsyncResource } from './hooks';
import { AsyncSection, InlineNote } from './ui';

export interface StudentNotesTabProps {
  studentId: number;
  /** Bumped by the page after a successful write to refresh the timeline. */
  onChanged?: () => void;
}

export function StudentNotesTab({ studentId, onChanged }: StudentNotesTabProps) {
  const { hasPerm } = useAuth();
  const settings = useSettings();
  const canManage = hasPerm('students.manage');

  const resource = useAsyncResource(() => studentsApi.notes(studentId), `notes:${studentId}`);
  const notes = resource.data ?? [];

  const [body, setBody] = useState('');
  const [pinned, setPinned] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<unknown>(null);
  const [pendingDelete, setPendingDelete] = useState<StudentNote | null>(null);

  const submit = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    if (body.trim() === '') return;
    setSaving(true);
    setSaveError(null);
    try {
      await studentsApi.addNote(studentId, { body: body.trim(), is_pinned: pinned });
      setBody('');
      setPinned(false);
      resource.reload();
      onChanged?.();
    } catch (cause) {
      setSaveError(cause);
    } finally {
      setSaving(false);
    }
  };

  const remove = async (): Promise<void> => {
    if (pendingDelete === null) return;
    await studentsApi.deleteNote(studentId, pendingDelete.id);
    setPendingDelete(null);
    resource.reload();
    onChanged?.();
  };

  const generalMessages = generalErrorMessages(saveError);

  return (
    <div className="section-stack">
      {canManage ? (
        <Card title="Add a note" subtitle="Notes are internal and visible to staff only.">
          <form className="u-stack" onSubmit={(event) => void submit(event)}>
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

            <div className="field">
              <label className="field__label" htmlFor={`note-body-${studentId}`}>
                Note
              </label>
              <textarea
                id={`note-body-${studentId}`}
                className="textarea"
                rows={3}
                value={body}
                onChange={(event) => setBody(event.target.value)}
                placeholder="What should the team know about this student?"
                required
              />
            </div>

            <div className="u-row u-row--between">
              <label className="checkbox-row">
                <input
                  type="checkbox"
                  checked={pinned}
                  onChange={(event) => setPinned(event.target.checked)}
                />
                Pin this note to the top
              </label>
              <Button type="submit" variant="primary" icon="plus" loading={saving} disabled={body.trim() === ''}>
                Add note
              </Button>
            </div>
          </form>
        </Card>
      ) : (
        <InlineNote>You have read-only access, so notes cannot be added or removed.</InlineNote>
      )}

      <Card title="Notes" subtitle={`${settings.number(notes.length)} notes`}>
        <AsyncSection
          loading={resource.loading}
          error={resource.error}
          onRetry={resource.reload}
          isEmpty={notes.length === 0}
          emptyIcon="clipboard"
          emptyTitle="No notes yet"
          emptyMessage={
            canManage
              ? 'Use the form above to record the first internal note for this student.'
              : 'Internal notes added by staff will appear here.'
          }
          loadingRows={3}
        >
          <ul className="note-list">
            {notes.map((note) => (
              <li key={note.id} className={note.is_pinned ? 'note note--pinned' : 'note'}>
                <div className="note__head">
                  <div className="u-row">
                    {note.is_pinned ? <Badge tone="primary">Pinned</Badge> : null}
                    <span className="note__meta">
                      {note.author_name} · {settings.dateTime(note.created_at)}
                    </span>
                  </div>
                  {canManage ? (
                    <Button
                      size="sm"
                      variant="ghost"
                      icon="trash"
                      onClick={() => setPendingDelete(note)}
                      aria-label="Delete note"
                    >
                      Delete
                    </Button>
                  ) : null}
                </div>
                <p className="note__body">{note.body}</p>
              </li>
            ))}
          </ul>
        </AsyncSection>
      </Card>

      <ConfirmDialog
        open={pendingDelete !== null}
        tone="danger"
        title="Delete this note?"
        confirmLabel="Delete note"
        message={
          <div className="u-stack">
            <p>This permanently removes the note. The action is written to the audit log.</p>
            {pendingDelete !== null ? <blockquote className="u-muted">{pendingDelete.body}</blockquote> : null}
          </div>
        }
        onConfirm={remove}
        onCancel={() => setPendingDelete(null)}
      />
    </div>
  );
}

export default StudentNotesTab;
