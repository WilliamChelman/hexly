import { ChangeDetectionStrategy, Component, computed, inject, input, OnInit, signal } from '@angular/core';
import { Observable } from 'rxjs';
import { TranslocoPipe, TranslocoService } from '@jsverse/transloco';
import { PublicLink } from '@hexly/domain';
import { EntitiesClient, WorldsClient, ToasterService } from '@hexly/web-core';
import { Button } from './button';
import { Input } from './input';

/** Which resource this control links, and thus which client + public route it targets. */
export type PublicLinkKind = 'world' | 'entity';

/**
 * Mint / show / revoke the one active anonymous read-only link for a World or an Entity.
 * Exactly one active link per target: minting again returns the current token, so rotating
 * means revoke + re-mint. The token is a shareable `/public/{w|e}/:token` URL openable
 * without an account; a revoke stops it resolving immediately.
 */
@Component({
  selector: 'app-public-link',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [TranslocoPipe, Button, Input],
  template: `
    @if (token(); as t) {
      <div class="public-link-active">
        <input
          appInput
          class="public-link-url"
          data-testid="public-link-url"
          readonly
          [value]="url()"
          (focus)="$any($event.target).select()"
        />
        <button appButton size="sm" data-testid="public-link-copy" (click)="copy()">
          {{ 'ui.publicLink.copy' | transloco }}
        </button>
        <button appButton size="sm" danger data-testid="public-link-revoke" (click)="revoke()">
          {{ 'ui.publicLink.revoke' | transloco }}
        </button>
      </div>
    } @else {
      <button
        appButton
        variant="primary"
        size="sm"
        data-testid="public-link-create"
        [disabled]="busy()"
        (click)="mint()"
      >
        {{ 'ui.publicLink.create' | transloco }}
      </button>
    }
  `,
  styles: `
    @reference '#app-styles.css';
    .public-link-active {
      @apply flex items-center gap-2;
    }
    .public-link-url {
      @apply flex-1;
    }
  `,
})
export class PublicLinkControl implements OnInit {
  readonly kind = input.required<PublicLinkKind>();
  readonly id = input.required<string>();

  private readonly entities = inject(EntitiesClient);
  private readonly worlds = inject(WorldsClient);
  private readonly toaster = inject(ToasterService);
  private readonly transloco = inject(TranslocoService);

  /** The active token, or null when no link is minted yet. */
  readonly token = signal<string | null>(null);
  /** True while a mint is in flight, so the create button can't double-fire. */
  readonly busy = signal(false);

  /** The shareable public URL for the current token — `/public/w/:token` or `/public/e/:token`. */
  readonly url = computed(() => {
    const t = this.token();
    if (!t) return '';
    const segment = this.kind() === 'world' ? 'w' : 'e';
    return `${location.origin}/public/${segment}/${t}`;
  });

  ngOnInit(): void {
    this.link(this.id()).subscribe({
      next: (l) => this.token.set(l?.token ?? null),
      error: () => this.toaster.show(this.transloco.translate('ui.publicLink.loadError'), 'error'),
    });
  }

  mint(): void {
    this.busy.set(true);
    this.mintLink(this.id()).subscribe({
      next: (l) => {
        this.token.set(l.token);
        this.busy.set(false);
      },
      error: () => {
        this.busy.set(false);
        this.toaster.show(this.transloco.translate('ui.publicLink.mintError'), 'error');
      },
    });
  }

  revoke(): void {
    this.revokeLink(this.id()).subscribe({
      next: () => this.token.set(null),
      error: () => this.toaster.show(this.transloco.translate('ui.publicLink.revokeError'), 'error'),
    });
  }

  copy(): void {
    // navigator.clipboard is undefined on an insecure (HTTP) origin or an older browser —
    // the `?.` would silently no-op, so surface the same copyError toast a rejection gives.
    const copied = navigator.clipboard?.writeText(this.url());
    if (!copied) {
      this.toaster.show(this.transloco.translate('ui.publicLink.copyError'), 'error');
      return;
    }
    copied.then(
      () => this.toaster.show(this.transloco.translate('ui.publicLink.copied'), 'success'),
      () => this.toaster.show(this.transloco.translate('ui.publicLink.copyError'), 'error'),
    );
  }

  // The client trio switches on `kind` — the only difference between the two link surfaces.
  private link(id: string): Observable<PublicLink | null> {
    return this.kind() === 'world' ? this.worlds.link(id) : this.entities.link(id);
  }
  private mintLink(id: string): Observable<PublicLink> {
    return this.kind() === 'world' ? this.worlds.mintLink(id) : this.entities.mintLink(id);
  }
  private revokeLink(id: string): Observable<void> {
    return this.kind() === 'world' ? this.worlds.revokeLink(id) : this.entities.revokeLink(id);
  }
}
