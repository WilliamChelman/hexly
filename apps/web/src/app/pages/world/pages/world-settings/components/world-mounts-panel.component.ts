import { ChangeDetectionStrategy, Component, inject, input, OnInit, signal } from '@angular/core';
import { Observable } from 'rxjs';
import { TranslocoPipe, TranslocoService } from '@jsverse/transloco';
import { Mount, MountCandidate } from '@hexly/domain';
import { ToasterService, WorldsClient } from '@hexly/web-core';
import { ButtonComponent, SelectComponent } from '@hexly/web-ui';

/**
 * The World's **Mounts** (CONTEXT.md → Mount, ADR-0080): the ordered list of Containers this World
 * draws from, an add control over what the caller may mount, reorder, and unmount. World-Owner-only,
 * like every other pane on this page (ADR-0039).
 *
 * The add control offers what the *server* says is mountable — every installed **Compendium** plus
 * every World the caller Owns, minus what is already mounted. The Own-only rule is an authorisation
 * answer, so it is never re-derived here: an empty offer is an empty offer, not a filter this panel
 * applied.
 *
 * Every write answers with the whole ordered list, so there is nothing to reassemble and a refusal
 * leaves the list exactly as it was. Reorder is sent wholesale — the same "send the new array" the
 * Dashboard pins use — so a move is one request, not two.
 */
@Component({
  selector: 'app-world-mounts',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [TranslocoPipe, ButtonComponent, SelectComponent],
  template: `
    <ul class="mount-list">
      @for (mount of mounts(); track mount.containerId; let i = $index) {
        <li class="mount-row" [attr.data-testid]="'mount-' + mount.containerId">
          <span class="mount-name">{{ mount.name }}</span>
          <!-- Which kind it is, said in words: "my other World" and "an installed pack" are not the
               same thing to the Owner arranging them. -->
          <span class="mount-kind" [attr.data-testid]="'mount-kind-' + mount.containerId">
            {{ 'mounts.kind.' + mount.kind | transloco }}
          </span>
          <button
            appButton
            size="sm"
            [disabled]="i === 0"
            [attr.aria-label]="'mounts.moveUpLabel' | transloco: { name: mount.name }"
            [attr.data-testid]="'mount-up-' + mount.containerId"
            (click)="move(i, -1)"
          >
            ↑
          </button>
          <button
            appButton
            size="sm"
            [disabled]="i === mounts().length - 1"
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
            (click)="remove(mount.containerId)"
          >
            {{ 'mounts.unmount' | transloco }}
          </button>
        </li>
      } @empty {
        <li class="mount-empty">{{ 'mounts.empty' | transloco }}</li>
      }
    </ul>

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
        <button appButton variant="primary" data-testid="mount-add" [disabled]="!selected()" (click)="add()">
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
  protected readonly candidates = signal<readonly MountCandidate[]>([]);
  /** The Container picked in the add control, or '' for the placeholder. */
  protected readonly selected = signal<string>('');

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
    if (!containerId) return;
    this.apply(this.worlds.addMount(this.id(), containerId), 'mounts.addError', () => this.selected.set(''));
  }

  /** Withdraw one declaration. The Container itself is untouched — nothing is deleted here. */
  protected remove(containerId: string): void {
    this.apply(this.worlds.removeMount(this.id(), containerId), 'mounts.removeError');
  }

  /**
   * Swap a Mount with its neighbour and store the whole new order. A no-op past either end, so the
   * disabled arrows are the affordance rather than the rule.
   */
  protected move(index: number, delta: number): void {
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
    op$.subscribe({
      next: (mounts) => {
        this.mounts.set(mounts);
        onOk?.();
        this.loadCandidates();
      },
      error: () => this.error(errorKey),
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
