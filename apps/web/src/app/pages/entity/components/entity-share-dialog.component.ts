import { ChangeDetectionStrategy, Component, computed, inject, input, output } from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';
import { ButtonComponent, DialogComponent } from '@hexly/web-ui';
import { GrantSetComponent, OwnerSetComponent, PublicLinkComponent } from '@hexly/web-entity';
import { ClientConfigStore } from '@hexly/web-core';
import { EntitySession } from '../services/entity-session';

/**
 * The open Entity's Share dialog (ADR-0037): owner-set, named per-Entity grants, and the anonymous
 * Public Link — the owner-only sharing surface. Driven by the {@link open} input; its content mounts
 * only while open, so it never fetches owners/grants for a closed dialog. {@link resigned} fires when
 * the caller resigns ownership, which can cost reach to the Entity — the caller navigates away.
 *
 * The surface guards itself on the Collaboration layer (ADR-0071), so no host can mount three parts
 * whose endpoints 404.
 *
 * `display:contents` (host) so the wrapper adds no box to the header's layout.
 */
@Component({
  selector: 'app-entity-share-dialog',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'contents' },
  imports: [ButtonComponent, DialogComponent, GrantSetComponent, OwnerSetComponent, PublicLinkComponent, TranslocoPipe],
  template: `
    @if (open() && collaboration() && entityId(); as id) {
      <app-dialog [open]="true" [heading]="'collab.owners.heading' | transloco" (closed)="closed.emit()">
        <app-owner-set kind="entity" [id]="id" (resigned)="resigned.emit()" />
        <!-- Named per-Entity grants (ADR-0037, #161): the surgical layer below ownership —
             hand a specific user Editor/Viewer on just this Entity, piercing private. -->
        <h3 class="grants-heading">{{ 'collab.grants.heading' | transloco }}</h3>
        <p class="grants-subhead">{{ 'collab.grants.subhead' | transloco }}</p>
        <app-grant-set [id]="id" />
        <!-- Anonymous per-entity Public Link (ADR-0037, #162): one revocable read-only URL
             for someone without an account — pierces private, like a named Viewer grant. -->
        <h3 class="grants-heading">
          {{ 'collab.publicLink.entityHeading' | transloco }}
        </h3>
        <p class="grants-subhead">
          {{ 'collab.publicLink.entitySubhead' | transloco }}
        </p>
        <app-public-link kind="entity" [id]="id" />
        <button dialogFooter type="button" appButton data-testid="owners-close" (click)="closed.emit()">
          {{ 'common.close' | transloco }}
        </button>
      </app-dialog>
    }
  `,
  styles: `
    @reference '#app-styles.css';
    /* Separates the grant set from the owner set above it in the Share dialog. */
    .grants-heading {
      @apply mt-6 border-t border-line pt-4 text-sm font-semibold text-ink;
    }
    .grants-subhead {
      @apply mb-3 text-sm text-ink-muted;
    }
  `,
})
export class EntityShareDialogComponent {
  private readonly session = inject(EntitySession);
  private readonly clientConfig = inject(ClientConfigStore);

  /** Whether the dialog is shown; the caller owns this state (toggled from the actions menu). */
  readonly open = input(false);
  /** Fired on close (backdrop, Escape, or the Close button) so the caller can flip {@link open}. */
  readonly closed = output<void>();
  /** Fired when the caller resigns their ownership — reach to this Entity may be gone. */
  readonly resigned = output<void>();

  /** The open Entity's id — the sharing target; empty when none is open. */
  protected readonly entityId = computed(() => this.session.current()?.id ?? '');

  /** Whether the Collaboration layer is on (ADR-0071) — with it off there is nothing to share. */
  protected readonly collaboration = computed(() => this.clientConfig.isCollaborationEnabled());
}
