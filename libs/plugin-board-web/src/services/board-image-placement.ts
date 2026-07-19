import { inject, Injectable } from '@angular/core';
import { take } from 'rxjs';
import { Point } from '@hexly/plugin-board';
import { DialogService } from '@hexly/web-ui';
import { ENTITY_SESSION } from '@hexly/web-entity';
import { BoardStore } from './board-store';
import { BoardImagePickerComponent, ImagePickerData } from '../components/board-image-picker.component';

/**
 * Places an **Image** Board Element (#269): the async half the pure {@link BoardStore} can't own. Unlike
 * Box/Text, an Image needs a World Asset URL *before* it lands, so the Image Tool's canvas click routes
 * here — this opens the source chooser ({@link BoardImagePickerComponent}: upload a file or pick an
 * existing Asset), and on a choice funnels the chosen URL into {@link BoardStore.addImage} at the clicked
 * world point. A cancelled chooser places nothing.
 *
 * Route-scoped (provided by the Board View, not `providedIn: 'root'`): it reads the open Entity's
 * `worldId` off the route-scoped {@link ENTITY_SESSION} — the World whose Assets the picker uploads into
 * and lists. Without a resolved World there is nowhere to mint an Asset, so the request is a no-op.
 */
@Injectable()
export class BoardImagePlacement {
  private readonly dialogs = inject(DialogService);
  private readonly session = inject(ENTITY_SESSION);
  private readonly store = inject(BoardStore);

  /**
   * Open the Image source chooser for the current World; on a choice, add an Image at world `position`
   * displaying the chosen Asset. A no-op if no World is resolved or the chooser is cancelled.
   */
  place(position: Point): void {
    const worldId = this.session.current()?.worldId;
    if (!worldId) return;
    const ref = this.dialogs.open<ImagePickerData, string>(BoardImagePickerComponent, { worldId });
    ref.closed.pipe(take(1)).subscribe((url) => {
      if (url) this.store.addImage(position, url);
    });
  }
}
