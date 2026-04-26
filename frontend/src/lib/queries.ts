import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiRequest } from './api';

export interface Expense {
  id: string;
  amount_paise: number;
  category: string;
  description: string;
  date: string;
  created_at: string;
}

export interface CreateExpenseInput {
  amount: string;
  category: string;
  description: string;
  date: string;
}

export function useExpenses(filters: { category?: string; sort?: 'date_desc' }) {
  return useQuery({
    queryKey: ['expenses', filters],
    queryFn: () => {
      const params = new URLSearchParams();
      if (filters.category) params.set('category', filters.category);
      if (filters.sort) params.set('sort', filters.sort);
      const qs = params.toString();
      return apiRequest<Expense[]>(`/expenses${qs ? `?${qs}` : ''}`);
    },
  });
}

export function useCreateExpense() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ body, idempotencyKey }: { body: CreateExpenseInput; idempotencyKey: string }) =>
      apiRequest<Expense>('/expenses', {
        method: 'POST',
        headers: { 'Idempotency-Key': idempotencyKey },
        body: JSON.stringify(body),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['expenses'] }),
  });
}
