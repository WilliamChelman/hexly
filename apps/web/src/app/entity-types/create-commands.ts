import { Injectable, inject } from '@angular/core';
import { TranslocoService } from '@jsverse/transloco';
import { Observable, of } from 'rxjs';
import { DialogService } from '@hexly/web-ui';
import { Command, CommandProvider } from '@hexly/command-palette-web';
import { CreateEntityDialogComponent } from './create-entity-dialog.component';
import { TypeRegistry } from './type-registry';

/**
 * The `>`-prefix static Commands that open the create dialog (ADR-0032): one Command per registered
 * Entity Type, rather than one Command with a type picker. Each just opens
 * {@link CreateEntityDialogComponent} via {@link DialogService}, seeded with its type; the dialog, not
 * this Provider, drives the name/World form and the `EntitiesClient.create()` call. Ids derive from
 * the type id, labels from the type's own `create` chrome (ADR-0048), so a registered type gets its
 * Command for free.
 */
@Injectable({ providedIn: 'root' })
export class CreateCommands implements CommandProvider {
  private readonly dialogs = inject(DialogService);
  private readonly transloco = inject(TranslocoService);
  private readonly types = inject(TypeRegistry);

  readonly prefix = '>';
  readonly label = 'commandPalette.commands';

  search(query: string): Observable<readonly Command[]> {
    const q = query.trim().toLowerCase();
    const commands: Command[] = this.types.all().map((def) => ({
      id: `create-${def.id}`,
      label: this.types.chromeLabel(def.id, 'create'),
      run: () => this.dialogs.open(CreateEntityDialogComponent, { type: def.id }),
    }));
    return of(commands.filter((c) => c.label.toLowerCase().includes(q)));
  }
}
