import { inject, Injectable } from '@angular/core';
import {
  ActivatedRouteSnapshot,
  RouterStateSnapshot,
  TitleStrategy,
} from '@angular/router';
import { TitleService } from './title.service';

/**
 * The router's title hook (ADR-0014). It does no rendering itself — it reads the
 * active route's title intent and hands it to {@link TitleService}, the single
 * owner of the tab title. A route's `title` is a translation key (so titles
 * localize); a route may additionally derive its title from the open document by
 * declaring `data.documentTitleKey`, a brand template with a `{{name}}` slot the
 * page fills via {@link TitleService.setDocumentName} (the editor reads
 * `"Aldermoor — Hexly"`).
 *
 * A route with no `title` leaves the current tab title untouched, and a literal
 * (unmigrated) title resolves to itself (a missing key falls back to the key
 * text), so routes keep working until they adopt keys.
 */
@Injectable()
export class TranslationTitleStrategy extends TitleStrategy {
  private readonly titles = inject(TitleService);

  override updateTitle(snapshot: RouterStateSnapshot): void {
    const key = this.buildTitle(snapshot);
    if (key === undefined) return;
    this.titles.setRouteTitle({ key, namedKey: this.documentTitleKey(snapshot) });
  }

  /**
   * The `documentTitleKey` declared by a route in the activated primary chain,
   * or `undefined` when none opts its title into the open document's name.
   */
  private documentTitleKey(snapshot: RouterStateSnapshot): string | undefined {
    for (
      let route: ActivatedRouteSnapshot | null = snapshot.root;
      route;
      route = route.firstChild
    ) {
      const key = route.data['documentTitleKey'];
      if (typeof key === 'string') return key;
    }
    return undefined;
  }
}
