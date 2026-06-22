import { inject, Injectable } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Title } from '@angular/platform-browser';
import { RouterStateSnapshot, TitleStrategy } from '@angular/router';
import { TranslocoService } from '@jsverse/transloco';

/**
 * Resolves a route's `title` as a translation key rather than a literal string
 * (ADR-0014), so tab titles localize. The key's value carries the "Hexly" brand
 * wherever the page wants it (`"Hexly — Sign in"`), so the product name is the
 * same untranslated token in every language. The title re-resolves on a live
 * language switch, with no navigation.
 *
 * A route still carrying a literal title resolves to itself (a missing key
 * falls back to the key text), so unmigrated routes keep working until they
 * adopt keys.
 */
@Injectable()
export class TranslationTitleStrategy extends TitleStrategy {
  private readonly title = inject(Title);
  private readonly transloco = inject(TranslocoService);

  /**
   * The most recent route state, kept so a language switch can re-resolve the
   * current title without injecting the Router (which would form a DI cycle,
   * since the Router itself depends on the TitleStrategy).
   */
  private latest?: RouterStateSnapshot;

  constructor() {
    super();
    this.transloco.langChanges$.pipe(takeUntilDestroyed()).subscribe(() => {
      if (this.latest) this.updateTitle(this.latest);
    });
  }

  override updateTitle(snapshot: RouterStateSnapshot): void {
    this.latest = snapshot;
    const key = this.buildTitle(snapshot);
    if (key !== undefined) {
      this.title.setTitle(this.transloco.translate(key));
    }
  }
}
