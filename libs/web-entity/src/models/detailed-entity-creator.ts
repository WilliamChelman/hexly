import { InjectionToken } from '@angular/core';
import { Observable, of } from 'rxjs';
import { EntitySummary, EntityType } from '@hexly/domain';

/** What Inline Creation's details path seeds the create-Entity dialog with (ADR-0073). */
export interface DetailedEntitySeed {
  /** The name typed at the `@`, prefilling the dialog's name field. */
  readonly name: string;
  /** The host Entity's World: pinned and locked, never offered — typing must not author a cross-World link. */
  readonly worldId: string;
  /** The Instance's `entities.inlineType`, seeded as the primary Type the author may then add to. */
  readonly type: EntityType;
  /** The Instance's `entities.inlineTag`, prefilling the dialog's tags. */
  readonly tags: readonly string[];
}

/**
 * Open the create-Entity dialog seeded for Inline Creation, resolving with the Entity it created or
 * `null` when the author cancelled (ADR-0073). Emits once, then completes.
 */
export type DetailedEntityCreator = (seed: DetailedEntitySeed) => Observable<EntitySummary | null>;

/**
 * DI seam for the details path of Inline Creation (ADR-0073): the app binds the concrete dialog opener
 * — the create dialog lives beside the Type registry a plugin cannot reach — and the content editor's
 * `@` picker consumes it, the same way an Embed reaches its Views through {@link ENTITY_VIEW_CHOICES}.
 *
 * The default declines: a surface mounted without the app around it offers the row and creates nothing,
 * rather than throwing out of a keystroke.
 */
export const DETAILED_ENTITY_CREATOR = new InjectionToken<DetailedEntityCreator>('DETAILED_ENTITY_CREATOR', {
  providedIn: 'root',
  factory: () => () => of(null),
});
