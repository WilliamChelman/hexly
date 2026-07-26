import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { EntityDetail, EntitySummary, EntityType } from '@hexly/domain';
import { CORE_NOTE_TYPE } from '@hexly/plugin-content';
import { ClientConfigStore, EntitiesClient } from '@hexly/web-core';
import { DETAILED_ENTITY_CREATOR } from '@hexly/web-entity';

/**
 * Inline Creation's writes (ADR-0073): the Entity a mention names, minted under the Instance's
 * `entities.inlineType`/`entities.inlineTag` — deliberately not the New button's `defaultType`, which
 * answers a different question — and into the World it is named from.
 *
 * Two paths over one set of knobs: {@link create} is the silent fast path, {@link createWithDetails}
 * seeds the same knobs into the create dialog for an author who wants Types and Tags set before the
 * thing exists. The dialog is a modal you ask for, so the fast path is unchanged by its existence.
 *
 * Unconditional by design: no mintable-Type filter and no create-dialog fallback, because an unfilled
 * `required` Field no longer refuses a write (ADR-0074).
 */
@Injectable({ providedIn: 'root' })
export class InlineEntityCreator {
  private readonly entities = inject(EntitiesClient);
  private readonly config = inject(ClientConfigStore);
  private readonly openDetails = inject(DETAILED_ENTITY_CREATOR);

  /**
   * Mint `name` in `worldId` — the host Entity's World, never a picked one: typing must not author a
   * cross-World link as a side effect (ADR-0073).
   */
  create(name: string, worldId: string): Observable<EntityDetail> {
    const tags = this.tags();
    return this.entities.create(name, [this.type()], worldId, undefined, tags.length ? tags : undefined);
  }

  /**
   * The same mint through the ordinary create dialog, seeded with the typed name and the Inline Creation
   * knobs and locked to `worldId` (ADR-0073). Resolves `null` when the author cancels — the caller then
   * leaves the typed text where it is rather than inserting a link.
   */
  createWithDetails(name: string, worldId: string): Observable<EntitySummary | null> {
    return this.openDetails({ name, worldId, type: this.type(), tags: this.tags() });
  }

  /**
   * `inlineType` reads `undefined` only when `/api/config` never landed; the Instance's own default is
   * `core.type.note`, so mint that rather than refuse the gesture.
   */
  private type(): EntityType {
    return this.config.inlineType() ?? CORE_NOTE_TYPE.id;
  }

  /** No Tag unless the Instance names one: nothing is imposed on an author who wants no bookkeeping. */
  private tags(): readonly string[] {
    const tag = this.config.inlineTag();
    return tag ? [tag] : [];
  }
}
