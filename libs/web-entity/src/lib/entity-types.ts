import { InjectionToken, Signal } from '@angular/core';
import { TypeDefinition, TypeLabels } from './type-definition';

/**
 * The registered Entity Types, as a **lib** reads them: the read surface of the app's `TypeRegistry`,
 * declared here so a shared control — or a plugin — can ask what types exist without depending on
 * `apps/web`. The same inversion {@link ENTITY_SESSION} rides (ADR-0048): the abstraction lives
 * beside the plugin seam, and the composition root binds the concrete registry to it.
 *
 * It is the whole reason a control like the {@link EntityLinkPicker} can offer "create and link"
 * without naming a single type id: the types, their names, and their untitled defaults all arrive
 * from here.
 */
export interface EntityTypes {
  /** Every registered type, in registration order: core, the bundled plugins, then the World's own. */
  readonly all: Signal<readonly TypeDefinition[]>;
  /**
   * A type's **display name** — the noun every surface shows for it ("Note", "Hex Map", "Deity").
   * A user-defined type's is authored data, never a transloco key (#191).
   */
  name(type: string | null | undefined): string;
  /** One of a type's **chrome** labels — its create heading, the default name a blank create takes. */
  chromeLabel(type: string | null | undefined, key: keyof TypeLabels): string;
}

/** DI token for the {@link EntityTypes}; the composition root binds the concrete registry to it. */
export const ENTITY_TYPES = new InjectionToken<EntityTypes>('ENTITY_TYPES');
