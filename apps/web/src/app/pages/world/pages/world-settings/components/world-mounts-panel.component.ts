import { ChangeDetectionStrategy, Component, inject, input, OnInit, signal } from '@angular/core';
import { Observable } from 'rxjs';
import { TranslocoPipe, TranslocoService } from '@jsverse/transloco';
import { Mount } from '@hexly/domain';
import { blastRadius, ToasterService, WorldsClient } from '@hexly/web-core';
import { ButtonComponent, DialogComponent, SelectComponent } from '@hexly/web-ui';

/**
 * The World's **Mounts** (CONTEXT.md → Mount, ADR-0080): the ordered list of Containers this World
 * draws from, an add control over what the caller may mount, reorder, and unmount. World-Owner-only,
 * like every other pane on this page (ADR-0039).
 *
 * The add control offers what the *server* says is mountable and never re-derives it: the Own-only
 * rule is an authorisation answer, so an empty offer is an empty offer rather than a filter applied
 * here. Every write answers with the whole ordered list, so a refusal leaves the list exactly as the
 * server last said it was.
 */
@Component({
  selector: 'app-world-mounts',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [TranslocoPipe, ButtonComponent, DialogComponent, SelectComponent],
  template: `
    <ul class="mount-list">
      @for (mount of mounts(); track mount.containerId; let i = $index) {
        <li class="mount-row" [attr.data-testid]="'mount-' + mount.containerId">
          <span class="mount-name">{{ mount.name }}</span>
          <span class="mount-kind" [attr.data-testid]="'mount-kind-' + mount.containerId">
            {{ 'mounts.kind.' + mount.kind | transloco }}
          </span>
          <button
            appButton
            size="sm"
            [disabled]="i === 0 || writing()"
            [attr.aria-label]="'mounts.moveUpLabel' | transloco: { name: mount.name }"
            [attr.data-testid]="'mount-up-' + mount.containerId"
            (click)="move(i, -1)"
          >
            ↑
          </button>
          <button
            appButton
            size="sm"
            [disabled]="i === mounts().length - 1 || writing()"
            [attr.aria-label]="'mounts.moveDownLabel' | transloco: { name: mount.name }"
            [attr.data-testid]="'mount-down-' + mount.containerId"
            (click)="move(i, 1)"
          >
            ↓
          </button>
          <button
            appButton
            size="sm"
            danger
            [attr.data-testid]="'mount-remove-' + mount.containerId"
            (click)="askUnmount(mount)"
          >
            {{ 'mounts.unmount' | transloco }}
          </button>
        </li>
      } @empty {
        <li class="mount-empty">{{ 'mounts.empty' | transloco }}</li>
      }
    </ul>

    @if (pendingUnmount(); as target) {
      <!-- The blast radius before the act (ADR-0080, #414): a number and a confirm, never a veto. The
           button below is live from the first frame, so a count still loading — or one that failed to
           load — delays nothing. -->
      <app-dialog
        [open]="true"
        [heading]="'mounts.unmountHeading' | transloco: { name: target.name }"
        (closed)="cancelUnmount()"
        data-testid="unmount-modal"
      >
        <p class="text-sm text-ink-muted m-0" data-testid="unmount-count">
          @if (blast.count(); as count) {
            @if (count.links === 0) {
              {{ 'mounts.unmountNone' | transloco }}
            } @else {
              {{ 'mounts.unmountCount' | transloco: { count: count.links } }}
            }
          } @else if (blast.failed()) {
            {{ 'mounts.unmountCountUnknown' | transloco }}
          } @else {
            {{ 'mounts.unmountCounting' | transloco }}
          }
        </p>
        <button dialogFooter type="button" appButton data-testid="cancel-unmount" (click)="cancelUnmount()">
          {{ 'common.cancel' | transloco }}
        </button>
        <button dialogFooter type="button" appButton danger data-testid="confirm-unmount" (click)="confirmUnmount()">
          {{ 'mounts.unmount' | transloco }}
        </button>
      </app-dialog>
    }

    <div class="mount-add">
      <label class="mount-add-label" for="mount-add-select">{{ 'mounts.addLabel' | transloco }}</label>
      <div class="mount-add-row">
        <select
          appSelect
          id="mount-add-select"
          class="mount-select"
          data-testid="mount-add-select"
          [value]="selected()"
          (change)="selected.set($any($event.target).value)"
        >
          <option value="">{{ 'mounts.addPlaceholder' | transloco }}</option>
          @for (candidate of candidates(); track candidate.containerId) {
            <option [value]="candidate.containerId">
              {{ candidate.name }} — {{ 'mounts.kind.' + candidate.kind | transloco }}
            </option>
          }
        </select>
        <button
          appButton
          variant="primary"
          data-testid="mount-add"
          [disabled]="!selected() || writing()"
          (click)="add()"
        >
          {{ 'mounts.add' | transloco }}
        </button>
      </div>
      @if (candidates().length === 0) {
        <p class="mount-add-empty" data-testid="mount-add-empty">{{ 'mounts.noCandidates' | transloco }}</p>
      }
    </div>
  `,
  styles: `
    @reference '#app-styles.css';
    .mount-list {
      @apply flex flex-col gap-1;
    }
    .mount-row {
      @apply flex items-center gap-3 py-1;
    }
    .mount-name {
      @apply flex-1 text-ink-strong;
    }
    .mount-kind {
      @apply text-2xs text-ink-muted uppercase;
    }
    .mount-empty {
      @apply py-1 text-sm text-ink-muted;
    }
    .mount-add {
      @apply mt-4 flex flex-col gap-2;
    }
    .mount-add-label {
      @apply text-sm font-semibold text-ink-muted;
    }
    .mount-add-row {
      @apply flex items-center gap-2;
    }
    .mount-add-empty {
      @apply text-sm text-ink-muted;
    }
    /* Layout only — the look is the appSelect primitive's. */
    .mount-add-row .mount-select {
      @apply flex-1;
    }
  `,
})
export class WorldMountsPanelComponent implements OnInit {
  readonly id = input.required<string>();

  private readonly worlds = inject(WorldsClient);
  private readonly toaster = inject(ToasterService);
  private readonly transloco = inject(TranslocoService);

  protected readonly mounts = signal<readonly Mount[]>([]);
  protected readonly candidates = signal<readonly Mount[]>([]);
  /** The Container picked in the add control, or '' for the placeholder. */
  protected readonly selected = signal<string>('');
  /** The Mount whose unmount is being confirmed, or null when no confirm is open. */
  protected readonly pendingUnmount = signal<Mount | null>(null);
  /** What the open confirm's unmount would break (ADR-0080, #414). */
  protected readonly blast = blastRadius();
  /**
   * Whether a write is still in flight. Every write answers with the whole ordered list, so the list a
   * second click would compute its new order from is the *stale* one until that answer lands — a rapid
   * second arrow would send the order the first one already sent and be swallowed by the server's
   * unchanged-order short-circuit. The controls say so rather than accepting a click they will lose.
   */
  protected readonly writing = signal(false);

  ngOnInit(): void {
    this.worlds.mounts(this.id()).subscribe({
      next: (mounts) => this.mounts.set(mounts),
      error: () => this.error('mounts.loadError'),
    });
    this.loadCandidates();
  }

  /** Declare one more Container this World draws from. Idempotent server-side, so a double-add is safe. */
  protected add(): void {
    const containerId = this.selected();
    if (!containerId || this.writing()) return;
    this.apply(this.worlds.addMount(this.id(), containerId), 'mounts.addError', () => this.selected.set(''));
  }

  /** Offer the unmount, and read what it would break while the confirm is open (ADR-0080, #414). */
  protected askUnmount(mount: Mount): void {
    this.pendingUnmount.set(mount);
    this.blast.read(this.worlds.mountInboundLinks(this.id(), mount.containerId));
  }

  protected cancelUnmount(): void {
    this.pendingUnmount.set(null);
  }

  /**
   * Withdraw one declaration, whatever the count said. The Container itself is untouched — nothing is
   * deleted here; the links into it simply stop resolving for everyone but their Owner.
   */
  protected confirmUnmount(): void {
    const target = this.pendingUnmount();
    if (!target) return;
    this.pendingUnmount.set(null);
    this.apply(this.worlds.removeMount(this.id(), target.containerId), 'mounts.removeError');
  }

  /**
   * Swap a Mount with its neighbour and store the whole new order. A no-op past either end, so the
   * disabled arrows are the affordance rather than the rule.
   */
  protected move(index: number, delta: number): void {
    if (this.writing()) return;
    const order = this.mounts().map((m) => m.containerId);
    const target = index + delta;
    if (target < 0 || target >= order.length) return;
    [order[index], order[target]] = [order[target], order[index]];
    this.apply(this.worlds.reorderMounts(this.id(), order), 'mounts.reorderError');
  }

  /**
   * Adopt a write's answer — the whole ordered list — and re-read the offer, since what is mountable
   * is exactly what is not yet mounted. A refusal toasts and leaves the list as the server last said.
   */
  private apply(op$: Observable<Mount[]>, errorKey: string, onOk?: () => void): void {
    this.writing.set(true);
    op$.subscribe({
      next: (mounts) => {
        this.writing.set(false);
        this.mounts.set(mounts);
        onOk?.();
        this.loadCandidates();
      },
      error: () => {
        this.writing.set(false);
        this.error(errorKey);
      },
    });
  }

  private loadCandidates(): void {
    this.worlds.mountCandidates(this.id()).subscribe({
      next: (candidates) => this.candidates.set(candidates),
      error: () => this.error('mounts.candidatesError'),
    });
  }

  private error(key: string): void {
    this.toaster.show(this.transloco.translate(key), 'error');
  }
}
