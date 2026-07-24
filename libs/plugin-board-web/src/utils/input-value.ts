/** The current value of the input that raised `event`. */
export function inputValue(event: Event): string {
  return (event.target as HTMLInputElement).value;
}

/**
 * The numeric value of the input that raised `event`, or `null` when it holds nothing committable: an
 * empty field (`Number('') === 0` would silently commit zero) or a non-finite entry (`1e400`).
 */
export function inputNumber(event: Event): number | null {
  const raw = inputValue(event).trim();
  if (raw === '') return null;
  const value = Number(raw);
  return Number.isFinite(value) ? value : null;
}
