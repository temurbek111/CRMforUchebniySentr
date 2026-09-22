import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { Icon } from './Icon';

export interface ComingSoonProps {
  /** Module the future page belongs to, e.g. "Students". */
  module: string;
  /** Page title within the module, e.g. "Groups". */
  title?: string;
  /** Route path this placeholder is mounted at. */
  path?: string;
  /** Extra context for whoever picks the page up next. */
  note?: ReactNode;
}

/**
 * Honest placeholder for routes whose page implementation is owned by another
 * workstream. It deliberately renders no business data so nobody mistakes it
 * for a finished screen.
 */
export function ComingSoon({ module, title, path, note }: ComingSoonProps): ReactNode {
  const heading = title === undefined ? module : title;

  return (
    <div className="coming-soon">
      <span className="coming-soon__badge">
        <Icon name="alertCircle" size={12} />
        Not implemented yet
      </span>
      <h1 className="coming-soon__title">{heading}</h1>
      {path !== undefined ? <span className="coming-soon__path">{path}</span> : null}
      <p className="coming-soon__message">
        This screen is part of the <strong>{module}</strong> module and has not been built yet. The
        application shell, design system, API layer and shared components are complete, so this page
        only needs its own content.
      </p>
      {note !== undefined ? <div className="u-muted">{note}</div> : null}
      <Link className="btn btn--secondary" to="/">
        <Icon name="home" size={15} />
        Back to dashboard
      </Link>
    </div>
  );
}

export default ComingSoon;
