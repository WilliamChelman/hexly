import { ChangeDetectionStrategy, Component, computed, inject, output } from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';
import {
  ButtonComponent,
  IconComponent,
  MenuGroupDirective,
  MenuItemDirective,
  MenuItemCheckboxDirective,
  MenuItemRadioDirective,
  MenuPanelDirective,
  MenuTriggerDirective,
} from '@hexly/web-ui';
import { Visibility } from '@hexly/domain';
import { EntitySession } from '../services/entity-session';
import { ActiveWorld, ClientConfigStore } from '@hexly/web-core';

/**
 * The open Entity's actions overflow menu: Visibility, Pin, and Share behind one trigger.
 * The trigger shows only when the caller has at least one of them; each item is independently
 * guarded. Visibility and Pin act in place; Share is the header's dialog surface, so this only
 * emits {@link share} and the header opens it. Share and Visibility also need the Collaboration
 * layer (ADR-0071); Edit types and Pin do not.
 *
 * `display:contents` (host) so the trigger sits directly in the page header's action row.
 */
@Component({
  selector: 'app-entity-actions-menu',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'contents' },
  imports: [
    MenuTriggerDirective,
    MenuPanelDirective,
    MenuItemDirective,
    MenuItemCheckboxDirective,
    MenuGroupDirective,
    MenuItemRadioDirective,
    ButtonComponent,
    IconComponent,
    TranslocoPipe,
  ],
  template: `
    @if (editable() || canPin() || shareable()) {
      <button
        type="button"
        appButton
        variant="ghost"
        size="sm"
        icon
        data-testid="entity-actions"
        [appMenuTrigger]="actionsMenu"
        [attr.aria-label]="'editorShell.actionsMenu' | transloco"
      >
        <app-icon name="more" [size]="18" />
      </button>
    }

    <ng-template #actionsMenu>
      <div appMenuPanel>
        @if (editable()) {
          <!-- Edit types (#189): add/remove/reorder the type set — substance, so any writer may. -->
          <button type="button" appMenuItem data-testid="edit-types" (triggered)="editTypes.emit()">
            <span class="flex items-center gap-2">
              <app-icon name="label" [size]="16" />
              {{ 'entityTypes.editTypes' | transloco }}
            </span>
          </button>
        }

        @if (visibilityToggleable()) {
          <!-- Visibility control (ADR-0037/0084, #160/#433): an Owner sets the Entity's rung —
             private, shared, or open (Instance-wide reachable). A radiogroup so exactly one stays
             checked; a non-Owner's set is refused server-side (403). -->
          <div appMenuGroup role="group" [attr.aria-label]="'editorShell.visibility.label' | transloco">
            @for (option of visibilityOptions; track option) {
              <button
                type="button"
                appMenuItemRadio
                [checked]="visibility() === option"
                [attr.data-testid]="'visibility-set-' + option"
                (triggered)="setVisibility(option)"
              >
                <span>{{ 'editorShell.visibility.' + option | transloco }}</span>
              </button>
            }
          </div>
        }

        @if (canPin()) {
          <!-- Pin to Dashboard (ADR-0043, #169): a World Owner features the open Entity on
             the World Dashboard without a trip to the Dashboard picker. Hidden for
             non-Owners; the check reflects the shared pin set, so it reads right on load. -->
          <button
            type="button"
            appMenuItemCheckbox
            [checked]="pinned()"
            data-testid="pin-toggle"
            [attr.aria-label]="'editorShell.pin.toggle' | transloco"
            (triggered)="togglePin()"
          >
            <span>{{ 'editorShell.pin.pin' | transloco }}</span>
          </button>
        }

        @if (shareable()) {
          <!-- Share (owner/grant/link management) is an owner-only power (ADR-0037) — hidden
             for every non-Owner opener, including writers (an entity-level Editor, a World
             Owner) whose write access wouldn't carry the owner-gated dialog endpoints. -->
          <button type="button" appMenuItem data-testid="manage-owners" (triggered)="share.emit()">
            <span class="flex items-center gap-2">
              <app-icon name="share" [size]="16" />
              {{ 'editorShell.share' | transloco }}
            </span>
          </button>
        }
      </div>
    </ng-template>
  `,
})
export class EntityActionsMenuComponent {
  private readonly session = inject(EntitySession);
  private readonly activeWorld = inject(ActiveWorld);
  private readonly clientConfig = inject(ClientConfigStore);

  /** Open the owner/grant/link Share dialog — owned by the header, its dialog surface. */
  readonly share = output<void>();

  /** Open the Edit-types dialog (#189) — likewise owned by the header. */
  readonly editTypes = output<void>();

  /** Visibility and rename are gated on write access (ADR-0037): a read-only opener sees neither. */
  protected readonly editable = this.session.writable;

  /**
   * Whether the caller owns the open Entity (ADR-0037): the dialog behind Share (owners, grants,
   * Public Link) is owner-only server-side.
   */
  private readonly manageable = this.session.manageable;

  /** Whether to offer Share: an Owner, and a Collaboration layer to share into (ADR-0071). */
  protected readonly shareable = computed(() => this.manageable() && this.clientConfig.isCollaborationEnabled());

  /** Whether to offer the Visibility toggle: a writer, and a Collaboration layer that reads the column. */
  protected readonly visibilityToggleable = computed(
    () => this.editable() && this.clientConfig.isCollaborationEnabled(),
  );

  /** The three rungs, low to high (ADR-0084): each renders a radio row, the current one checked. */
  protected readonly visibilityOptions: readonly Visibility[] = ['private', 'shared', 'open'];

  /** The open Entity's current rung (drives which radio reads checked); `private` before one loads. */
  protected readonly visibility = computed<Visibility>(() => this.session.current()?.visibility ?? 'private');

  /**
   * Whether the caller is a World Owner (`manage` Right on the active World, ADR-0039) — gates the
   * Pin toggle; a non-Owner's pin would 403 server-side, so the toggle stays hidden entirely.
   *
   * Never offered for a **Sealed** entry, whatever the caller's standing: a pin is a World pointing at
   * an Entity, and nothing outside a **Compendium** points at one (ADR-0079).
   */
  protected readonly canPin = computed(
    () => !this.session.current()?.sealed && (this.activeWorld.world()?.rights.includes('manage') ?? false),
  );

  /** Whether the open Entity sits in the World's shared pin set (drives the checked state). */
  protected readonly pinned = computed(() => {
    const id = this.session.current()?.id;
    return !!id && (this.activeWorld.world()?.pinnedEntityIds.includes(id) ?? false);
  });

  /**
   * Pin/unpin the open Entity to the World Dashboard (ADR-0043): the pin set is sent wholesale via
   * {@link ActiveWorld.commitPins}, never as a single-id delta.
   */
  protected togglePin(): void {
    const world = this.activeWorld.world();
    const id = this.session.current()?.id;
    if (!world || !id) return;
    this.activeWorld.commitPins(
      world.pinnedEntityIds.includes(id)
        ? world.pinnedEntityIds.filter((x) => x !== id)
        : [...world.pinnedEntityIds, id],
    );
  }

  /** Set the open Entity's Visibility rung (ADR-0037/0084, #160/#433); a rejected set leaves state as the server has it. */
  protected setVisibility(next: Visibility): void {
    // Re-selecting the current rung is a no-op — nothing to send, and no spurious PATCH.
    if (next === this.visibility()) return;
    // Swallow like commit()'s rename: a rejected set (e.g. a 403 from a writable-then-revoked
    // race) is a graceful no-op — the checked state stays bound to the server's Visibility, so
    // there's nothing to revert — not an unhandled RxJS error.
    this.session.setVisibility(next).subscribe({ error: () => undefined });
  }
}
