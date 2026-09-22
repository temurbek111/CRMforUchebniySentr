import { LedgerPage } from './LedgerPage';
import { INCOME_CATEGORIES } from './shared';

/**
 * Income ledger: registration/exam fees and any other money in that is not a
 * student fee payment. Totals come from /api/finance/summary/breakdown/.
 */
export function IncomePage() {
  return (
    <LedgerPage
      title="Income"
      subtitle="Non-fee income — registration and exam fees, plus anything else that is not a student payment."
      variant="income"
      noun="income entry"
      managePermission="income.manage"
      categories={INCOME_CATEGORIES}
    />
  );
}

export default IncomePage;
