import { InjectionToken, Signal } from '@angular/core';
import { Field } from '@hexly/domain';
import { TypeDefinition, TypeLabels } from './type-definition';

/**
 * The registered Entity Types, as a **lib** reads them: the read surface of the app's `TypeRegistry`,
 * declared here so a shared control — or a plugin — can ask what types exist without depending on
 * `apps/web` (the same inversion {@link ENTITY_SESSION} rides, ADR-0048).
 */
export interface EntityTypes {
  /** Every registered type, in registration order: core, the bundled plugins, then the World's own. */
  readonly all: Signal<readonly TypeDefinition[]>;
  /**
   * The types a user may create — {@link all} minus the **System-managed** ones (ADR-0068), which the
   * system alone mints. What every create surface offers, so none of them restates the rule.
   */
  readonly creatable: Signal<readonly TypeDefinition[]>;
  /**
   * Whether the caller may **mint** a new user-defined type inline (#438) — the Owner gate, so a
   * create surface shows its affordance without restating who governs Container-wide vocabulary. The
   * concrete registry derives it from the active World's Rights; adding an *existing* type stays the
   * separate entity-write gate ({@link EntitySession.writable}).
   */
  canCreate(): boolean;
  /**
   * Eagerly mint a bare user-defined type from the typed `label` (#438) — the id is derived from it
   * (never surfaced), the type born with empty Fields and the generic View, growable later in World
   * Settings. Resolves to the new type's id once it is registered client-side, so the caller can add
   * it to an Entity's staged type set. Owner-gated: only call when {@link canCreate} is true.
   */
  create(label: string): Promise<string>;
  /**
   * A type's **display name** — the noun every surface shows for it ("Note", "Hex Map", "Deity").
   * A user-defined type's is authored data, never a transloco key.
   */
  name(type: string | null | undefined): string;
  /** One of a type's **chrome** labels — its create heading, the default name a blank create takes. */
  chromeLabel(type: string | null | undefined, key: keyof TypeLabels): string;
  /**
   * The union of Fields an Entity carrying `types` affords — primary type first, deduped by id. The
   * type-only projection of {@link effectiveFields}, for the create and type-authoring surfaces (no
   * attachments in play).
   */
  resolveFields(types: readonly string[] | null | undefined): Field[];
  /**
   * An Entity's **effective Field set** (CONTEXT.md → Entity, ADR-0054/ADR-0056): its attached Fields
   * (`fieldIds`) unioned with its types' defaults, deduped by `id`.
   */
  effectiveFields(types: readonly string[] | null | undefined, fieldIds: readonly string[] | null | undefined): Field[];
  /**
   * The definition for a registered, **active** type, or `undefined` for an unknown or disabled one —
   * how a surface tells a type it can label from one it must render as its raw id (a missing Plugin).
   */
  get(type: string | null | undefined): TypeDefinition | undefined;
  /** A registered Field by id, or `undefined` for an unknown or disabled one — what labels an attached Field. */
  field(id: string): Field | undefined;
  /**
   * Every **Facet** key a Facet Token may name (ADR-0082) — each facetable Field's id, then the
   * dimensions this build's Structured Data Types harvest. Read **synchronously** off the registry,
   * never off a Facet read, so a search box in a lib knows its whole vocabulary whatever the network
   * is doing.
   */
  facetKeys(): string[];
  /**
   * The registered Fields an Entity carrying `types`/`fieldIds` may still **attach directly** (ADR-0054):
   * every available Field whose `id` its effective set does not already cover — the attach picker's offer.
   */
  attachableFields(
    types: readonly string[] | null | undefined,
    fieldIds: readonly string[] | null | undefined,
  ): Field[];
}

/** DI token for the {@link EntityTypes}; the composition root binds the concrete registry to it. */
export const ENTITY_TYPES = new InjectionToken<EntityTypes>('ENTITY_TYPES');
