import { LedgerPage } from './LedgerPage';
import { EXPENSE_CATEGORIES } from './shared';

/**
 * Expense ledger. Payroll runs that have been paid appear here automatically:
 * paying a run books a "Teacher Salaries" expense (see the finance services),
 * so those rows are created by the payroll module rather than typed in by hand.
 */
export function ExpensesPage() {
  return (
    <LedgerPage
      title="Expenses"
      subtitle="Money out — rent, utilities, marketing, materials and everything else."
      variant="expenses"
      noun="expense"
      managePermission="expenses.manage"
      categories={EXPENSE_CATEGORIES}
      footnote={
        <>
          <strong>Teacher salaries:</strong> paying a payroll run books a “Teacher Salaries” expense
          automatically, so those rows appear here and should not be entered twice. Voiding them does
          not un-pay the run.
        </>
      }
    />
  );
}

export default ExpensesPage;
