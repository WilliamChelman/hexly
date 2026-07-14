import { Injectable, computed, inject, signal } from '@angular/core';
import { CONTENT_FIELD, Content, extractOutline, OutlineHeading } from '@hexly/plugin-content';
import { EntitySession } from './entity-session';

/**
 * Route-scoped UI state for the Outline — the heading-navigation panel beside the Content
 * editor (CONTEXT.md). Headings derive from the session's live Content via
 * {@link extractOutline}; the panel owns the scroll and scrollspy DOM work. Whether the panel
 * *shows* is {@link RightDock}'s state, not this store's.
 */
@Injectable()
export class OutlineStore {
  private readonly session = inject(EntitySession);

  private readonly _contentRoot = signal<HTMLElement | null>(null);
  /**
   * The Content editor element whose headings the Outline navigates, bridged in by the
   * OutlineSource directive. The panel must scope its DOM queries to this exact element rather
   * than a document-wide `.ProseMirror` lookup, which could pick up a second editor.
   */
  readonly contentRoot = this._contentRoot.asReadonly();

  /** Registered by the OutlineSource directive on mount; cleared to `null` on teardown. */
  setContentRoot(element: HTMLElement | null): void {
    this._contentRoot.set(element);
  }

  /** Headings of the open Entity's prose, in document order (empty ones skipped). */
  readonly headings = computed<OutlineHeading[]>(
    () => {
      // The prose lives at the `content` Field key now (ADR-0051); a prose-less body has no headings.
      const content = this.session.doc()[CONTENT_FIELD.key] as Content | undefined;
      return content ? extractOutline(content) : [];
    },
    {
      // The content value is a fresh object on every commit, so re-emit only when the heading
      // set truly changes — otherwise the panel rebuilds its scrollspy and flashes the
      // active highlight back to the top on every key pressed anywhere in the document.
      equal: (a, b) => a.length === b.length && a.every((h, i) => h.text === b[i].text && h.level === b[i].level),
    },
  );
}
