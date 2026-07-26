import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { EntityDetail } from '@hexly/domain';
import { CORE_NOTE_TYPE } from '@hexly/plugin-content';
import { ClientConfigStore, EntitiesClient } from '@hexly/web-core';

/**
 * Inline Creation's one write (ADR-0073): the Entity a mention names, minted under the Instance's
 * `entities.inlineType`/`entities.inlineTag` — deliberately not the New button's `defaultType`, which
 * answers a different question — and into the World it is named from.
 *
 * Unconditional by design: no mintable-Type filter and no create-dialog fallback, because an unfilled
 * `required` Field no longer refuses a write (ADR-0074).
 */
@Injectable({ providedIn: 'root' })
export class InlineEntityCreator {
  private readonly entities = inject(EntitiesClient);
  private readonly config = inject(ClientConfigStore);

  /**
   * Mint `name` in `worldId` — the host Entity's World, never a picked one: typing must not author a
   * cross-World link as a side effect (ADR-0073).
   *
   * The knobs read `undefined` only when `/api/config` never landed; the Instance's own default is
   * `core.type.note`, so mint that rather than refuse the gesture.
   */
  create(name: string, worldId: string): Observable<EntityDetail> {
    const type = this.config.inlineType() ?? CORE_NOTE_TYPE.id;
    const tag = this.config.inlineTag();
    return this.entities.create(name, [type], worldId, undefined, tag ? [tag] : undefined);
  }
}
