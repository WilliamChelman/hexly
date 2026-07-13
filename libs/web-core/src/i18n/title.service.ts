import { inject, Injectable, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Title } from '@angular/platform-browser';
import { TranslocoService } from '@jsverse/transloco';

/** The active route's title keys, as handed over by the title strategy. */
interface RouteTitle {
  /** The route's static title key — the fallback / no-document case. */
  readonly key: string;
  /**
   * A brand-template key with a `{{name}}` slot the open document's name fills
   * (`"{{name}} — Hexly"`), for a route that titles itself from its document.
   */
  readonly namedKey?: string;
}

/**
 * The single owner of the browser tab title (ADR-0014): it composes the active route's title key
 * (fed by {@link TranslationTitleStrategy}) with the open document's name, and re-resolves whenever
 * either changes or the language flips, with no navigation. A feature page sets its title through
 * {@link setDocumentName}, never through the DOM `Title`.
 */
@Injectable({ providedIn: 'root' })
export class TitleService {
  private readonly title = inject(Title);
  private readonly transloco = inject(TranslocoService);

  /** The active route's title keys, or `null` before the first titled navigation. */
  private route: RouteTitle | null = null;

  private readonly _documentName = signal<string | null>(null);
  /** The open document's name composed into the tab title, or `null` when none. */
  readonly documentName = this._documentName.asReadonly();

  constructor() {
    // Re-resolve the current title on a live language switch, with no navigation.
    this.transloco.langChanges$.pipe(takeUntilDestroyed()).subscribe(() => this.render());
  }

  /** Adopt the active route's title keys — called by the title strategy on navigation. */
  setRouteTitle(route: RouteTitle): void {
    this.route = route;
    this.render();
  }

  /**
   * Set (or clear with `null`) the open document's display name. A route with a brand template
   * composes it ("Aldermoor — Hexly"); until it is set, that route falls back to its static key.
   * The owning page must clear it (`null`) when it leaves, or a stale name shadows the next
   * page's title.
   */
  setDocumentName(name: string | null): void {
    this._documentName.set(name);
    this.render();
  }

  /** Resolve the route key (+ optional document name) to the tab title and set it. */
  private render(): void {
    if (!this.route) return;
    const { key, namedKey } = this.route;
    const name = this._documentName();
    this.title.setTitle(
      namedKey && name ? this.transloco.translate(namedKey, { name }) : this.transloco.translate(key),
    );
  }
}
