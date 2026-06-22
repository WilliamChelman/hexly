import { Injectable, signal } from '@angular/core';

/** Simple declarative content a page contributes to the single {@link AppHeader}. */
export interface HeaderContent {
  /** The small label above the title (e.g. "Library"). */
  readonly eyebrow?: string;
  /** The page's heading shown in the header (e.g. "Your maps"). */
  readonly title?: string;
}

/**
 * The stateful, signal-based half of the header's hybrid content mechanism
 * (ADR-0015): a page sets simple declarative text on activation and the
 * {@link AppHeader} reads it back through signals. Rich, interactive header
 * content goes through the named `header` router-outlet instead.
 */
@Injectable({ providedIn: 'root' })
export class HeaderService {
  private readonly _eyebrow = signal<string | null>(null);
  private readonly _title = signal<string | null>(null);

  /** The eyebrow the active page set, or `null` when none. */
  readonly eyebrow = this._eyebrow.asReadonly();
  /** The title the active page set, or `null` when none. */
  readonly title = this._title.asReadonly();

  /** Set the header's declarative content; omitted fields reset to empty. */
  set(content: HeaderContent): void {
    this._eyebrow.set(content.eyebrow ?? null);
    this._title.set(content.title ?? null);
  }

  /** Clear all declarative content (a page is leaving). */
  clear(): void {
    this._eyebrow.set(null);
    this._title.set(null);
  }
}
