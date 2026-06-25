import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  signal,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router } from '@angular/router';
import { catchError, EMPTY, filter, map, switchMap, tap } from 'rxjs';
import { EditorSession } from '../editor-shell/editor-session';
import { EditorShell } from '../editor-shell/editor-shell';
import { NoteView } from '../note-view/note-view';

/**
 * The one open-Entity route (#70): `/entities/:id` loads the Entity the URL
 * points at, then dispatches by its `type` — a `hexmap` opens the full
 * {@link EditorShell}, a `note` the minimal {@link NoteView}. The type is known
 * only after the load, so this thin shell does the load (reusing an already
 * adopted Entity without a round trip, ADR-0018) and renders the right view
 * once it resolves. A failed load (404 — deleted, foreign, or typo'd id) returns
 * to the library rather than stranding the user on a blank page (#3).
 */
@Component({
  selector: 'app-entity-shell',
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
export class EntityShell {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly session = inject(EditorSession);

  /** The id the route currently points at — gates the view so a stale Entity
   * (held by the session mid-navigation) never renders the wrong shell. */
  private readonly routedId = signal<string | null>(null);

  /** Which view to render, or `null` until the routed Entity has loaded. */
  protected readonly view = computed(() => {
    const current = this.session.current();
    return current && current.id === this.routedId()
      ? current.document.type
      : null;
  });

  constructor() {
    // Open whatever Entity the URL points at, reopening on an id change. The
    // editor's own openRoute (when EditorShell mounts) then reuses this load.
    this.route.paramMap
      .pipe(
        map((params) => params.get('id')),
        filter((id): id is string => id !== null),
        tap((id) => this.routedId.set(id)),
        switchMap((id) =>
          this.session.openRoute(id).pipe(
            catchError(() => {
              this.router.navigateByUrl('/entities');
              return EMPTY;
            }),
          ),
        ),
        takeUntilDestroyed(),
      )
      .subscribe();
  }
}
