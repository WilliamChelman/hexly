import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router } from '@angular/router';
import { catchError, EMPTY, filter, map, switchMap } from 'rxjs';
import { EditorSession } from '../editor-shell/editor-session';
import { EditorShell } from '../editor-shell/editor-shell';
import { NoteView } from '../note-view/note-view';

/**
 * The open-Entity route (`/entities/:id`, #70): loads the Entity, then dispatches
 * by `type` — `hexmap` → {@link EditorShell}, `note` → {@link NoteView}. A failed
 * load (404) sends the user back to the library (#3).
 *
 * Single loader for the route: views only read `session.current()`. Dispatching on
 * the open Entity's `type` (not a routed-id gate) keeps the editor mounted across
 * map→map navigation — only the canvas swaps.
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

  /** Which view to render, or `null` until an Entity is open. */
  protected readonly view = computed(
    () => this.session.current()?.document.type ?? null,
  );

  constructor() {
    // switchMap cancels an in-flight load on id change, so /entities/A then
    // /entities/B can't let a stale A response land over B's canvas.
    this.route.paramMap
      .pipe(
        map((params) => params.get('id')),
        filter((id): id is string => id !== null),
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
