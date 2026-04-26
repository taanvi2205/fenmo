import { useState, FormEvent } from 'react';
import { useCreateExpense } from '../lib/queries';
import { useIdempotencyKey } from '../lib/idempotency';
import { ApiError } from '../lib/api';

const CATEGORIES = ['Food', 'Transport', 'Shopping', 'Bills', 'Entertainment', 'Health', 'Other'] as const;

interface FormState {
  amount: string;
  category: string;
  description: string;
  date: string;
}

function emptyForm(): FormState {
  return {
    amount: '',
    category: '',
    description: '',
    date: new Date().toISOString().slice(0, 10),
  };
}

function validate(form: FormState): { ok: true } | { ok: false; errors: Record<string, string> } {
  const errors: Record<string, string> = {};
  if (!/^\d+(\.\d{1,2})?$/.test(form.amount)) {
    errors.amount = 'Enter a valid amount (e.g. 324.50)';
  } else if (parseFloat(form.amount) <= 0) {
    // parseFloat only used for zero-check, never stored
    errors.amount = 'Amount must be greater than zero';
  }
  if (!form.category) errors.category = 'Select a category';
  if (!form.description.trim()) errors.description = 'Description is required';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(form.date)) errors.date = 'Enter a valid date';
  return Object.keys(errors).length === 0 ? { ok: true } : { ok: false, errors };
}

export default function ExpenseForm() {
  const [form, setForm] = useState<FormState>(emptyForm);
  const [localErrors, setLocalErrors] = useState<Record<string, string>>({});
  const { key, refresh } = useIdempotencyKey();
  const mutation = useCreateExpense();

  const set = (field: keyof FormState) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setForm((prev) => ({ ...prev, [field]: e.target.value }));

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    const result = validate(form);
    if (!result.ok) {
      setLocalErrors(result.errors);
      return;
    }
    setLocalErrors({});
    mutation.mutate(
      { body: form, idempotencyKey: key },
      {
        onSuccess: () => {
          setForm(emptyForm());
          refresh();
        },
      }
    );
  };

  const fieldError = (field: string): string | undefined => {
    if (localErrors[field]) return localErrors[field];
    if (mutation.error instanceof ApiError && mutation.error.fieldErrors?.[field]) {
      return mutation.error.fieldErrors[field][0];
    }
    return undefined;
  };

  const isNetworkOrServerError =
    mutation.isError &&
    (!(mutation.error instanceof ApiError) ||
      (mutation.error.status >= 500 && !mutation.error.fieldErrors));

  return (
    <section className="card">
      <form className="expense-form" onSubmit={onSubmit} noValidate>
        <div className="form-grid">
          <div className="field">
            <label htmlFor="amount">
              Amount (₹)<span className="required" aria-hidden="true">*</span>
            </label>
            <input
              id="amount"
              type="text"
              inputMode="decimal"
              value={form.amount}
              onChange={set('amount')}
              placeholder="0.00"
              autoComplete="off"
            />
            {fieldError('amount') && (
              <span className="field-error" role="alert">{fieldError('amount')}</span>
            )}
          </div>

          <div className="field">
            <label htmlFor="category">
              Category<span className="required" aria-hidden="true">*</span>
            </label>
            <select id="category" value={form.category} onChange={set('category')}>
              <option value="">Select a category</option>
              {CATEGORIES.map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
            {fieldError('category') && (
              <span className="field-error" role="alert">{fieldError('category')}</span>
            )}
          </div>

          <div className="field">
            <label htmlFor="description">
              Description<span className="required" aria-hidden="true">*</span>
            </label>
            <input
              id="description"
              type="text"
              value={form.description}
              onChange={set('description')}
              maxLength={500}
              placeholder="What was this for?"
            />
            {fieldError('description') && (
              <span className="field-error" role="alert">{fieldError('description')}</span>
            )}
          </div>

          <div className="field">
            <label htmlFor="date">
              Date<span className="required" aria-hidden="true">*</span>
            </label>
            <input
              id="date"
              type="date"
              value={form.date}
              onChange={set('date')}
            />
            {fieldError('date') && (
              <span className="field-error" role="alert">{fieldError('date')}</span>
            )}
          </div>
        </div>

        <div className="form-footer">
          <button type="submit" className="btn-primary" disabled={mutation.isPending}>
            {mutation.isPending ? 'Adding…' : 'Add Expense'}
          </button>

          {isNetworkOrServerError && (
            <div className="error-banner" role="alert">
              <span>Could not save. Check your connection and try again.</span>
              <button
                type="button"
                className="btn-secondary"
                onClick={() => mutation.mutate({ body: form, idempotencyKey: key })}
              >
                Retry
              </button>
            </div>
          )}
        </div>
      </form>
    </section>
  );
}
