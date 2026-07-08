import { InjectionToken, Signal } from '@angular/core';
import { Content, EntityDetail } from '@hexly/domain';

/**
 * The slice of the host's Entity session the {@link ContentEditor} drives against
 * (ADR-0019). Extracting the editor to its own lib inverts the old direct dependency
 * on the entity page's `EntitySession`: the page provides its session against this
 * token, keeping page state in the page while the editor stays framework-of-page-free.
 */
export interface ContentEditorSession {
  /** Live Content to (re)seed the editor from on mount; null mid-load. */
  readonly content: Signal<Content | null>;
  /** Whether the caller may edit — a read-only opener never autosaves (ADR-0037). */
  readonly writable: Signal<boolean>;
  /** The loaded Entity; a change recreates the editor (fresh undo history). */
  readonly seed: Signal<EntityDetail | null>;
  /** Stream the editor's latest snapshot back into the live Content. */
  setContent(snapshot: unknown): void;
}

export const CONTENT_EDITOR_SESSION = new InjectionToken<ContentEditorSession>(
  'CONTENT_EDITOR_SESSION',
);
