/**
 * The sunken well a picker's search box wears — `appInput`'s styling as a class string, because the
 * shared {@link FacetSearchInputComponent} owns its own `<input>` element and takes its chrome as
 * classes (ADR-0082), so the directive cannot be put on it.
 */
export const PICKER_BOX_CLASS =
  'w-full rounded-md border border-line-strong bg-surface-sunken px-3 py-2 text-sm text-ink-strong shadow-inset outline-none transition-colors focus:border-accent';
