import { Injectable, computed, inject, signal } from '@angular/core';
import { extractOutline, OutlineHeading } from '@hexly/domain';
import { AuthScopedStorage } from '../../../core/services/auth-scoped-storage';
import { EntitySession } from './entity-session';

/** Per-user preference key (auth-scoped), so one user's choice never leaks to the next. */
const STORAGE_KEY = 'outline.open';

/**
 * Route-scoped UI state for the Outline — the heading-navigation panel beside the
 * Content editor (CONTEXT.md). DOM-free by design: headings derive from the
 * session's live Content via {@link extractOutline}, so every keystroke refreshes
 * them without this store ever parsing Content itself; the panel owns the scroll
 * and scrollspy DOM work. Distinct from {@link EntitySession} (the document) and
 * the map's HexMapStore.
 */
@Injectable()
export class OutlineStore {
  private readonly session = inject(EntitySession);
  private readonly storage = inject(AuthScopedStorage);

  // Default closed; the last choice persists app-wide, per user, across reloads.
  private readonly _open = signal(this.storage.getItem(STORAGE_KEY) === '1');
  /** Whether the Outline panel is showing. */
  readonly isOpen = this._open.asReadonly();

  private readonly _contentRoot = signal<HTMLElement | null>(null);
  /**
   * The Content editor element whose headings the Outline navigates, bridged in by
   * the OutlineSource directive. The panel scopes its DOM queries to this exact
   * element instead of a document-wide `.ProseMirror` lookup, so a second editor on
   * the page can never be picked up by mistake.
   */
  readonly contentRoot = this._contentRoot.asReadonly();

  /** Registered by the OutlineSource directive on mount; cleared to `null` on teardown. */
  setContentRoot(element: HTMLElement | null): void {
    this._contentRoot.set(element);
  }

  /** Headings of the open Entity's Content, in document order (empty ones skipped). */
  readonly headings = computed<OutlineHeading[]>(
    () => {
      const content = this.session.content();
      return content ? extractOutline(content) : [];
    },
    {
      // content() is a fresh object every keystroke, so re-emit only when the heading
      // set truly changes — otherwise the panel rebuilds its scrollspy and flashes the
      // active highlight back to the top on every key pressed anywhere in the document.
      equal: (a, b) =>
        a.length === b.length &&
        a.every((h, i) => h.text === b[i].text && h.level === b[i].level),
    },
  );

  toggle(): void {
    this._open.update((open) => !open);
    this.storage.setItem(STORAGE_KEY, this._open() ? '1' : '0');
  }
}
