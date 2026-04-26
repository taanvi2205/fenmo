const RUPEE_REGEX = /^\d+(\.\d{1,2})?$/;

export function rupeesToPaise(rupees: string): number {
  if (!RUPEE_REGEX.test(rupees)) {
    throw new Error(`Invalid rupee amount: "${rupees}"`);
  }
  const [whole, frac = ''] = rupees.split('.');
  const paiseFrac = frac.padEnd(2, '0');
  // Use string arithmetic to avoid float precision issues
  return parseInt(whole, 10) * 100 + parseInt(paiseFrac, 10);
}

export function paiseToRupees(paise: number): string {
  const whole = Math.floor(paise / 100);
  const frac = String(paise % 100).padStart(2, '0');
  return `${whole}.${frac}`;
}
