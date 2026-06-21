/** The current value of the input that raised `event`. */
export function inputValue(event: Event): string {
  return (event.target as HTMLInputElement).value;
}
