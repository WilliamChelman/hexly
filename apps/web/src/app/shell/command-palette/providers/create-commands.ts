import { Injectable, inject } from '@angular/core';
import { TranslocoService } from '@jsverse/transloco';
import { Observable, of } from 'rxjs';
import { CreateEntityDialogState } from '../create-entity-dialog.state';
import { Command, CommandProvider } from '../command';

/**
 * The `>`-prefix static Commands that open the create dialog (ADR-0032):
 * "Create Note" and "Create Map" are two distinct Commands, not one with a
 * type picker. Each just flips {@link CreateEntityDialogState} — the dialog
 * itself, not this Provider, drives the name/World form and the actual
 * `EntitiesClient.create()` call.
 */
@Injectable({ providedIn: 'root' })
export class CreateCommands implements CommandProvider {
  private readonly dialogState = inject(CreateEntityDialogState);
  private readonly transloco = inject(TranslocoService);

  readonly prefix = '>';
  readonly label = 'commandPalette.commands';

  search(query: string): Observable<readonly Command[]> {
    const q = query.trim().toLowerCase();
    const commands: Command[] = [
      {
        id: 'create-note',
        label: this.transloco.translate('commandPalette.createNote'),
        run: () => this.dialogState.open('note'),
      },
      {
        id: 'create-map',
        label: this.transloco.translate('commandPalette.createMap'),
        run: () => this.dialogState.open('hexmap'),
      },
    ];
    return of(commands.filter((c) => c.label.toLowerCase().includes(q)));
  }
}
