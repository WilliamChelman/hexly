import { Injectable, inject } from '@angular/core';
import { TranslocoService } from '@jsverse/transloco';
import { Observable, of } from 'rxjs';
import { CreateEntityDialogState } from '../create-entity-dialog.state';
import { Command, CommandProvider } from '../command';
import { TypeRegistry } from '../../../entity-types/type-registry';

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
  private readonly types = inject(TypeRegistry);

  readonly prefix = '>';
  readonly label = 'commandPalette.commands';

  // The command id is the palette's stable handle; the type id drives the dialog
  // and the create label comes from the registry (ADR-0048).
  private static readonly COMMAND_ID: Record<string, string> = {
    note: 'create-note',
    hexmap: 'create-map',
  };

  search(query: string): Observable<readonly Command[]> {
    const q = query.trim().toLowerCase();
    const commands: Command[] = this.types.all().map((def) => ({
      id: CreateCommands.COMMAND_ID[def.id] ?? `create-${def.id}`,
      label: this.transloco.translate(def.labels.create),
      run: () => this.dialogState.open(def.id),
    }));
    return of(commands.filter((c) => c.label.toLowerCase().includes(q)));
  }
}
