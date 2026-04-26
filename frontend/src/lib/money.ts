const RUPEE_REGEX = /^\d+(\.\d{1,2})?$/;

const formatter = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR' });

export function validateAmountString(s: string): boolean {
  return RUPEE_REGEX.test(s);
}

export function paiseToRupees(paise: number): string {
  return formatter.format(paise / 100);
}
