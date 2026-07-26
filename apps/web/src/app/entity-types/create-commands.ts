import { Injectable, inject } from '@angular/core';
import { Router } from '@angular/router';
import { TranslocoService } from '@jsverse/transloco';
import { Observable, of } from 'rxjs';
import { EntityType } from '@hexly/domain';
import { DialogService } from '@hexly/web-ui';
import { Command, CommandProvider } from '@hexly/command-palette-web';
import { entityRoute } from '@hexly/web-core';
import {
  CreateEntityDialogComponent,
  CreateEntityDialogData,
  CreateEntityDialogResult,
} from './create-entity-dialog.component';
import { TypeRegistry } from './type-registry';

/**
 * The `>`-prefix static Commands that open the create dialog (ADR-0032): one Command per registered
 * Entity Type, rather than one Command with a type picker. Each just opens
 * {@link CreateEntityDialogComponent} via {@link DialogService}, seeded with its type; the dialog, not
 * this Provider, drives the name/World form and the `EntitiesClient.create()` call. Ids derive from
 * the type id, labels from the type's own `create` chrome (ADR-0048), so a registered type gets its
 * Command for free.
 *
 * Landing on the created Entity is this Command's own doing: the dialog only returns it (ADR-0073),
 * because a caller creating from mid-sentence must stay where it is.
 */
@Injectable({ providedIn: 'root' })
export class CreateCommands implements CommandProvider {
  private readonly dialogs = inject(DialogService);
  private readonly router = inject(Router);
  private readonly transloco = inject(TranslocoService);
  private readonly types = inject(TypeRegistry);

  readonly prefix = '>';
  readonly label = 'commandPalette.commands';

  search(query: string): Observable<readonly Command[]> {
    const q = query.trim().toLowerCase();
    // `creatable`, not `all`: a System-managed type (ADR-0068) gets no create Command.
    const commands: Command[] = this.types.creatable().map((def) => ({
      id: `create-${def.id}`,
      label: this.types.chromeLabel(def.id, 'create'),
      run: () => this.openCreateDialog(def.id),
    }));
    return of(commands.filter((c) => c.label.toLowerCase().includes(q)));
  }

  private openCreateDialog(type: EntityType): void {
    this.dialogs
      .open<CreateEntityDialogData, CreateEntityDialogResult>(CreateEntityDialogComponent, { type })
      // `closed` completes on the one emission, so nothing is left subscribed to a torn-down dialog.
      .closed.subscribe((entity) => {
        if (entity) void this.router.navigate(entityRoute(entity.worldId, entity.id));
      });
  }
}
