import { ComingSoon } from '../components/ComingSoon';

/**
 * Dashboard route. The dashboard widgets are owned by another workstream, so
 * this page only proves the shell works: it renders the shared placeholder and
 * deliberately shows no invented numbers.
 */
export function DashboardPage() {
  return <ComingSoon module="Dashboard" title="Dashboard" path="/" />;
}

export default DashboardPage;
