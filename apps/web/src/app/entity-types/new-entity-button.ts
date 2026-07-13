import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { finalize } from 'rxjs';
import { TranslocoPipe, TranslocoService } from '@jsverse/transloco';
import { CORE_NOTE, EntityType } from '@hexly/domain';
import { ActiveWorld, EntitiesClient, ToasterService, entityRoute } from '@hexly/web-core';
import { Button, ButtonGroup, Icon, MenuItem, MenuPanel, MenuTrigger } from '@hexly/web-ui';
import { TypeRegistry } from './type-registry';
import { TypeNamePipe } from './type-name.pipe';
import { CreateEntityDialogState } from '../shell/command-palette/create-entity-dialog.state';

/**
 * A split button: the primary action creates a **Note**, the arrowhead lists *every* Type the
 * {@link TypeRegistry} knows.
 *
 * A type declaring a **required** Field can't be minted blind, so it opens the create dialog,
 * which collects those Fields first. That is a rule about a type's *schema*: nothing here branches
 * on an id.
 */
@Component({
  selector: 'app-new-entity-button',
  changeDetection: ChangeDetectionStrategy.OnPush,
  // `display:contents` so the split button sits directly in a page header's action row.
  host: { class: 'contents' },
  imports: [Button, ButtonGroup, Icon, MenuTrigger, MenuPanel, MenuItem, TranslocoPipe, TypeNamePipe],
  template: `
    <div appButtonGroup>
      <button
        type="button"
        appButton
        variant="primary"
        data-testid="new-note"
        [disabled]="creating()"
        (click)="create(defaultType)"
      >
        <app-icon name="plus" [size]="16" />
        {{ (creating() ? 'entityBrowser.creating' : 'entityBrowser.newNote') | transloco }}
      </button>
      <button
        type="button"
        appButton
        variant="primary"
        icon
        data-testid="new-entity-menu"
        [disabled]="creating()"
        [appMenuTrigger]="typeMenu"
        [attr.aria-label]="'entityBrowser.newOtherType' | transloco"
      >
        <app-icon name="chevron-down" [size]="16" />
      </button>
    </div>

    <ng-template #typeMenu>
      <div appMenuPanel>
        @for (def of types(); track def.id) {
          <button type="button" appMenuItem [attr.data-testid]="'new-entity-' + def.id" (triggered)="create(def.id)">
            <span class="flex items-center gap-2">
              <app-icon [name]="def.icon" [size]="16" />
              {{ def.id | typeName }}
            </span>
          </button>
        }
      </div>
    </ng-template>
  `,
})
export class NewEntityButton {
  private readonly entitiesClient = inject(EntitiesClient);
  private readonly activeWorld = inject(ActiveWorld);
  private readonly router = inject(Router);
  private readonly toaster = inject(ToasterService);
  private readonly transloco = inject(TranslocoService);
  private readonly registry = inject(TypeRegistry);
  private readonly dialog = inject(CreateEntityDialogState);

  /** The primary action's type — the base body every Entity has, so a blank create is a Note. */
  protected readonly defaultType = CORE_NOTE;

  /** Every registered Type, in registration order: core, the bundled plugins, then the World's own. */
  protected readonly types = this.registry.all;

  protected readonly creating = signal(false);

  protected create(type: EntityType): void {
    if (this.creating()) return;
    // A required Field must be collected *before* the Entity exists, or the author lands on one
    // that cannot be saved (the write gate, #187). The create dialog is that collection surface.
    if (this.registry.resolveFields([type]).some((field) => field.required)) {
      this.dialog.open(type);
      return;
    }
    this.creating.set(true);
    this.entitiesClient
      .create(this.registry.chromeLabel(type, 'untitled'), [type], this.activeWorld.worldId() ?? undefined)
      .pipe(finalize(() => this.creating.set(false)))
      .subscribe({
        // EntitySession loads on open; no pre-adopt from here (it would outlive the create surface).
        next: (entity) =>
          this.router.navigate(
            entityRoute(this.activeWorld.worldId()!, entity.id, this.activeWorld.name() ?? undefined),
          ),
        error: () => this.toaster.show(this.transloco.translate('entityBrowser.createError'), 'error'),
      });
  }
}
