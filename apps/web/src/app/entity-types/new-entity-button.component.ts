import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { finalize } from 'rxjs';
import { TranslocoPipe, TranslocoService } from '@jsverse/transloco';
import { EntityType } from '@hexly/domain';
import { ActiveWorld, ClientConfigStore, EntitiesClient, ToasterService, entityRoute } from '@hexly/web-core';
import {
  ButtonComponent,
  ButtonGroupComponent,
  IconComponent,
  MenuItemDirective,
  MenuPanelDirective,
  MenuTriggerDirective,
} from '@hexly/web-ui';
import { TypeRegistry } from './type-registry';
import { TypeNamePipe } from './type-name.pipe';

/**
 * A split button: the primary action creates the Instance's default Type (`entities.defaultType`),
 * the arrowhead lists every *creatable* Type the {@link TypeRegistry} knows — a System-managed one
 * (ADR-0068) is never offered, the system alone mints it.
 *
 * Every Type mints directly, whatever Fields it declares `required` — absence never refuses a write
 * (ADR-0074), so nothing here branches on a Type's schema any more than on its id.
 */
@Component({
  selector: 'app-new-entity-button',
  changeDetection: ChangeDetectionStrategy.OnPush,
  // `display:contents` so the split button sits directly in a page header's action row.
  host: { class: 'contents' },
  imports: [
    ButtonComponent,
    ButtonGroupComponent,
    IconComponent,
    MenuTriggerDirective,
    MenuPanelDirective,
    MenuItemDirective,
    TranslocoPipe,
    TypeNamePipe,
  ],
  template: `
    <div appButtonGroup>
      @if (defaultType(); as type) {
        <button
          type="button"
          appButton
          variant="primary"
          data-testid="new-default-entity"
          [disabled]="creating()"
          (click)="create(type)"
        >
          <app-icon name="plus" [size]="16" />
          {{ creating() ? ('entityBrowser.creating' | transloco) : defaultLabel() }}
        </button>
      }
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
export class NewEntityButtonComponent {
  private readonly entitiesClient = inject(EntitiesClient);
  private readonly activeWorld = inject(ActiveWorld);
  private readonly router = inject(Router);
  private readonly toaster = inject(ToasterService);
  private readonly transloco = inject(TranslocoService);
  private readonly registry = inject(TypeRegistry);
  private readonly clientConfig = inject(ClientConfigStore);

  /**
   * The primary action's Type, resolved softly against the enabled registry (ADR-0052): the
   * configured `entities.defaultType` if registered → else the first enabled Type → else `undefined`,
   * which drops the primary button (an all-Plugins-off Instance).
   */
  protected readonly defaultType = computed<EntityType | undefined>(() => {
    const configured = this.clientConfig.defaultType();
    const creatable = this.registry.creatable();
    return creatable.find((def) => def.id === configured)?.id ?? creatable[0]?.id;
  });

  /** The primary button's copy — the resolved Type's own create chrome, not a static string (ADR-0052). */
  protected readonly defaultLabel = computed(() => {
    this.transloco.activeLang(); // reactive dependency: re-resolve on a language switch
    const type = this.defaultType();
    return type ? this.registry.chromeLabel(type, 'create') : '';
  });

  /** Every creatable Type, in registration order: the bundled plugins', then the World's own. */
  protected readonly types = this.registry.creatable;

  protected readonly creating = signal(false);

  protected create(type: EntityType): void {
    if (this.creating()) return;
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
