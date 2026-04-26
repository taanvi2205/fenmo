import { useMemo, useState } from 'react';
import { useExpenses, type Expense } from '../lib/queries';
import { paiseToRupees } from '../lib/money';
import { ApiError } from '../lib/api';

// ── Formatters ────────────────────────────────────────────────────────────────

const dateFormatter = new Intl.DateTimeFormat('en-IN', {
  day: '2-digit',
  month: 'short',
  year: 'numeric',
});

function formatDate(iso: string): string {
  // Parse as local date to avoid UTC-offset shifts (e.g. 2024-01-15 → "14 Jan" in UTC-1)
  const [y, m, d] = iso.split('-').map(Number);
  return dateFormatter.format(new Date(y, m - 1, d));
}

// ── Loading skeleton ──────────────────────────────────────────────────────────

function ListSkeleton() {
  return (
    <div className="skeleton-rows" aria-label="Loading expenses">
      {[0, 1, 2, 3].map((i) => (
        <div key={i} className="skeleton-row" />
      ))}
    </div>
  );
}

// ── Error state ───────────────────────────────────────────────────────────────

function ListError({ error, onRetry }: { error: unknown; onRetry: () => void }) {
  const message =
    error instanceof ApiError && error.status < 500
      ? error.message
      : "Couldn't load expenses.";
  return (
    <div className="list-state" role="alert">
      <p>{message}</p>
      <button type="button" className="btn-secondary" onClick={onRetry}>Retry</button>
    </div>
  );
}

// ── Empty state ───────────────────────────────────────────────────────────────

function ListEmpty({ hasFilter, onClear }: { hasFilter: boolean; onClear: () => void }) {
  return (
    <div className="list-state">
      {hasFilter ? (
        <>
          <p>No expenses in this category.</p>
          <button type="button" className="btn-secondary" onClick={onClear}>Clear filter</button>
        </>
      ) : (
        <p>No expenses yet. Add your first one above.</p>
      )}
    </div>
  );
}

// ── Controls row ──────────────────────────────────────────────────────────────

function ListControls({
  categories,
  category,
  onCategoryChange,
}: {
  categories: string[];
  category: string;
  onCategoryChange: (c: string) => void;
}) {
  return (
    <div className="list-controls-left">
      <label htmlFor="category-filter">Filter</label>
      <select
        id="category-filter"
        value={category}
        onChange={(e) => onCategoryChange(e.target.value)}
      >
        <option value="">All categories</option>
        {categories.map((c) => (
          <option key={c} value={c}>{c}</option>
        ))}
      </select>
      <span className="sort-label">Date ↓</span>
    </div>
  );
}

// ── Summary ───────────────────────────────────────────────────────────────────

function ListSummary({ expenses, category }: { expenses: Expense[]; category: string }) {
  const total = expenses.reduce((sum, e) => sum + e.amount_paise, 0);
  const label = category ? `Total (${category})` : 'Total';
  return (
    <div className="list-summary">
      <span>{expenses.length} {expenses.length === 1 ? 'expense' : 'expenses'}</span>
      <span>{label}: {paiseToRupees(total)}</span>
    </div>
  );
}

// ── Table ─────────────────────────────────────────────────────────────────────

function ListTable({ expenses }: { expenses: Expense[] }) {
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th scope="col">Date</th>
            <th scope="col">Category</th>
            <th scope="col">Description</th>
            <th scope="col" className="amount-col">Amount</th>
          </tr>
        </thead>
        <tbody>
          {expenses.map((e) => (
            <tr key={e.id}>
              <td className="td-date">{formatDate(e.date)}</td>
              <td><span className="category-pill">{e.category}</span></td>
              <td className="td-desc" title={e.description}>{e.description}</td>
              <td className="amount-col">{paiseToRupees(e.amount_paise)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ── Root component ────────────────────────────────────────────────────────────

export default function ExpenseList() {
  const [category, setCategory] = useState('');

  // Unfiltered query — used only to derive the category dropdown options.
  // Kept separate so the dropdown doesn't lose categories when a filter is active.
  const { data: allExpenses } = useExpenses({});

  // Filtered + sorted query — drives the table and total.
  const { data: expenses, isLoading, isError, error, refetch } = useExpenses({
    category: category || undefined,
    sort: 'date_desc',
  });

  const categories = useMemo(
    () => [...new Set(allExpenses?.map((e) => e.category) ?? [])].sort(),
    [allExpenses]
  );

  const clearFilter = () => setCategory('');

  return (
    <section className="card expense-list">
      <div className="list-controls-row">
        <ListControls
          categories={categories}
          category={category}
          onCategoryChange={setCategory}
        />
        {expenses && expenses.length > 0 && (
          <ListSummary expenses={expenses} category={category} />
        )}
      </div>

      {isLoading && <ListSkeleton />}
      {isError && <ListError error={error} onRetry={refetch} />}
      {!isLoading && !isError && expenses?.length === 0 && (
        <ListEmpty hasFilter={!!category} onClear={clearFilter} />
      )}
      {!isLoading && !isError && expenses && expenses.length > 0 && (
        <ListTable expenses={expenses} />
      )}
    </section>
  );
}
