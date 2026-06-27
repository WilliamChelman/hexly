import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
} from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { Observable, concat, ignoreElements, of } from 'rxjs';
import { EntitySession } from './services/entity-session';
import { EditorShell } from './components/editor-shell';
import { NoteView } from './components/note-view';

/**
 * The open-Entity route (`/entities/:id`, #70): dispatches by the open Entity's
 * `type` — `hexmap` → {@link EditorShell}, `note` → {@link NoteView}.
 *
 * Dispatching on the open Entity's `type` (not a routed-id gate) keeps the editor
 * mounted across map→map navigation — only the canvas swaps. The load itself is
 * the session's job: this hands it the ActivatedRoute (only the routed
 * component's injector carries the one bound to `:id`) and reads `current()`.
 */
@Component({
  selector: 'app-entity-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block h-full' },
  imports: [EditorShell, NoteView],
  template: `
    @switch (view()) {
      @case ('hexmap') {
        <app-editor-shell />
      }
      @case ('note') {
        <app-note-view />
      }
    }
  `,
})
export class EntityPage {
  private readonly session = inject(EntitySession);

  /** Which view to render, or `null` until an Entity is open. */
  protected readonly view = computed(
    () => this.session.current()?.document.type ?? null,
  );

  constructor() {
    this.session.watchRoute(inject(ActivatedRoute));
  }

  /**
   * Awaited by the route's CanDeactivate guard (ADR-0026): persist any pending edit before
   * the route is torn down, then allow the leave. Always resolves true — a failed/timed-out
   * flush is best-effort and must never trap the user on the page.
   */
  canDeactivate(): Observable<boolean> {
    return concat(this.session.flush().pipe(ignoreElements()), of(true));
  }
}
