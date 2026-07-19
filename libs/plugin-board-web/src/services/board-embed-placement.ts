import { inject, Injectable } from '@angular/core';
import { take } from 'rxjs';
import { Point } from '@hexly/plugin-board';
import { DialogService } from '@hexly/web-ui';
import { ENTITY_SESSION } from '@hexly/web-entity';
import { BoardStore } from './board-store';
import { BoardEmbedPickerComponent, EmbedChoice, EmbedPickerData } from '../components/board-embed-picker.component';

/**
 * Places an **Embed** Board Element (ADR-0062, #270): the async half the pure {@link BoardStore} can't
 * own. Like the Image Tool, the Embed Tool needs a choice — *which Entity* and *which View* — before the
 * element lands, so its canvas click routes here: this opens the target chooser
 * ({@link BoardEmbedPickerComponent}), and on a confirmed choice funnels it into {@link BoardStore.addEmbed}
 * at the clicked world point. A cancelled chooser places nothing.
 *
 * Route-scoped (provided by the Board View): it reads the open Board's `worldId` off the route-scoped
 * {@link ENTITY_SESSION} to scope the target search to this World. Without a resolved World the request
 * is a no-op.
 */
@Injectable()
export class BoardEmbedPlacement {
  private readonly dialogs = inject(DialogService);
  private readonly session = inject(ENTITY_SESSION);
  private readonly store = inject(BoardStore);

  /**
   * Open the Embed target chooser for the current World; on a confirmed choice, add an Embed at world
   * `position` transcluding the chosen Entity's chosen View. A no-op if no World is resolved or the
   * chooser is cancelled.
   */
  place(position: Point): void {
    const worldId = this.session.current()?.worldId;
    if (!worldId) return;
    const ref = this.dialogs.open<EmbedPickerData, EmbedChoice>(BoardEmbedPickerComponent, { worldId });
    ref.closed.pipe(take(1)).subscribe((choice) => {
      if (choice) this.store.addEmbed(position, choice.targetEntityId, choice.viewInstance);
    });
  }
}
