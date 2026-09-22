import { Link, useLocation } from 'react-router-dom';
import { Icon } from '../components/Icon';

/** Unknown route -> friendly 404 that keeps the user inside the app. */
export function NotFoundPage() {
  const location = useLocation();

  return (
    <div className="coming-soon">
      <span className="coming-soon__badge">
        <Icon name="alertCircle" size={12} />
        404
      </span>
      <h1 className="coming-soon__title">Page not found</h1>
      <span className="coming-soon__path">{location.pathname}</span>
      <p className="coming-soon__message">
        That address does not match any screen in this application. It may have been renamed, or the
        link may be out of date.
      </p>
      <Link className="btn btn--primary" to="/">
        <Icon name="home" size={15} />
        Back to dashboard
      </Link>
    </div>
  );
}

export default NotFoundPage;
