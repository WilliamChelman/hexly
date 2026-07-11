import { ChangeDetectionStrategy, Component, computed, inject, output } from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';
import { Button, Icon, MenuItem, MenuItemCheckbox, MenuPanel, MenuTrigger } from '@hexly/web-ui';
import { EntitySession } from '../services/entity-session';
import { ActiveWorld } from '@hexly/web-core';

/**
 * The open Entity's actions overflow menu (like the account menu): Visibility, Pin, and
 * Share behind one trigger. The trigger shows only when the caller has at least one of
 * them; each item is independently guarded. Visibility and Pin act in place; Share is the
 * header's dialog surface, so this only emits {@link share} and the header opens it.
 *
 * `display:contents` (host) so the trigger sits directly in the page header's action row.
 */
@Component({
  selector: 'app-entity-actions-menu',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'contents' },
  imports: [MenuTrigger, MenuPanel, MenuItem, MenuItemCheckbox, Button, Icon, TranslocoPipe],
  template: `
    @if (editable() || canPin() || manageable()) {
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
          <!-- Visibility toggle (ADR-0037, #160): an Owner flips the Entity between
             private and shared. A non-Owner's flip is refused server-side (403). -->
          <button
            type="button"
            appMenuItemCheckbox
            [checked]="shared()"
            data-testid="visibility-toggle"
            [attr.aria-label]="'editorShell.visibility.toggle' | transloco"
            (triggered)="toggleVisibility()"
          >
            <span>{{
              (shared() ? 'editorShell.visibility.shared' : 'editorShell.visibility.private') | transloco
            }}</span>
          </button>
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

        @if (manageable()) {
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
export class EntityActionsMenu {
  private readonly session = inject(EntitySession);
  private readonly activeWorld = inject(ActiveWorld);

  /** Open the owner/grant/link Share dialog — owned by the header, its dialog surface. */
  readonly share = output<void>();

  /** Visibility and rename are gated on write access (ADR-0037): a read-only opener sees neither. */
  protected readonly editable = this.session.writable;

  /**
   * Whether the caller owns the open Entity (ADR-0037) — gates the Share item, whose dialog
   * (owners, grants, Public Link) is owner-only server-side. A writer who isn't an Owner never
   * sees it, so it can't open onto a dialog that only 403s.
   */
  protected readonly manageable = this.session.manageable;

  /** Whether the open Entity is `shared` (drives the toggle's checked state and label). */
  protected readonly shared = computed(() => this.session.current()?.visibility === 'shared');

  /**
   * Whether the caller is a World Owner (`manage` Right on the active World, ADR-0039) —
   * gates the Pin toggle, matching the World Dashboard's curation controls (#168). A
   * non-Owner's pin would 403 server-side, so the toggle stays hidden entirely.
   */
  protected readonly canPin = computed(() => this.activeWorld.world()?.rights.includes('manage') ?? false);

  /** Whether the open Entity sits in the World's shared pin set (drives the checked state). */
  protected readonly pinned = computed(() => {
    const id = this.session.current()?.id;
    return !!id && (this.activeWorld.world()?.pinnedEntityIds.includes(id) ?? false);
  });

  /**
   * Pin/unpin the open Entity to the World Dashboard (ADR-0043, #169): add or drop its id and
   * send the pin set wholesale via {@link ActiveWorld.commitPins}, the shared home the Dashboard
   * curation controls also use — so both re-pin the World and toast a rejected curation alike.
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

  /** Flip the open Entity's Visibility (ADR-0037, #160); a rejected flip leaves state as the server has it. */
  protected toggleVisibility(): void {
    // Swallow like commit()'s rename: a rejected flip (e.g. a 403 from a writable-then-revoked
    // race) is a graceful no-op — the checked state stays bound to the server's Visibility, so
    // there's nothing to revert — not an unhandled RxJS error.
    this.session.setVisibility(this.shared() ? 'private' : 'shared').subscribe({ error: () => undefined });
  }
}
