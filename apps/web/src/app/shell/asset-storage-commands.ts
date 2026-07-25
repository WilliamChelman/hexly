import { Injectable, inject } from '@angular/core';
import { TranslocoService } from '@jsverse/transloco';
import { Observable, of } from 'rxjs';
import { Command, CommandDirectory, CommandProvider } from '@hexly/command-palette-web';
import { DESKTOP_BRIDGE } from '@hexly/web-core';
import { DialogService } from '@hexly/web-ui';
import { MoveAssetStorageDialogComponent } from './move-asset-storage-dialog.component';

/** Named by the Desktop App's native menu as well as the Palette (ADR-0070) — restated in `menu.ts`. */
export const MOVE_ASSET_STORAGE = 'move-asset-storage';

/**
 * Moving the Asset bytes to another folder (#326), offered on the two surfaces every Command has: the File
 * menu and the Palette. The Command owns nothing but the open — {@link MoveAssetStorageDialogComponent} drives
 * the move through the preload bridge, and main does the picking, copying and relaunching.
 *
 * Gated on the **bridge's presence**, not on the Deployment Profile: "is there a native folder picker and a
 * `hexly.yml` to rewrite?" is a capability question, and ADR-0071 says a capability question checks the
 * capability. A browser has no such affordance rather than a disabled one — including the desktop-profile
 * browser run the e2e suite uses, where there is genuinely nothing behind it.
 */
@Injectable({ providedIn: 'root' })
export class AssetStorageCommands implements CommandProvider {
  private readonly bridge = inject(DESKTOP_BRIDGE);
  private readonly dialogs = inject(DialogService);
  private readonly transloco = inject(TranslocoService);
  private readonly directory = inject(CommandDirectory);

  readonly prefix = '>';
  readonly label = 'commandPalette.commands';

  /** One object for both surfaces, held for the app's lifetime — hence the label getter, as `nav-commands` does. */
  private readonly move = this.moveCommand();

  constructor() {
    // Registered only where it can work. The menu is built at launch and names this id regardless, which the
    // Directory answers as a warning rather than a throw (ADR-0070).
    if (this.bridge) this.directory.register(this.move);
  }

  search(query: string): Observable<readonly Command[]> {
    if (!this.bridge) return of([]);
    const q = query.trim().toLowerCase();
    return of([this.move].filter((command) => command.label.toLowerCase().includes(q)));
  }

  private moveCommand(): Command {
    // Captured, because the getter's `this` is the literal: resolved on read so the label follows the language.
    const transloco = this.transloco;
    return {
      id: MOVE_ASSET_STORAGE,
      get label() {
        return transloco.translate('assetStorage.command');
      },
      run: () => void this.dialogs.open(MoveAssetStorageDialogComponent),
    };
  }
}
