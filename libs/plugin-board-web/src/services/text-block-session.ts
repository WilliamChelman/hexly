import { computed, inject, Injectable, signal } from '@angular/core';
import { EntityDocument, EntityType } from '@hexly/domain';
import { RichContent, emptyRichContent } from '@hexly/plugin-content';
import { ENTITY_SESSION, EntitySession, LiveEditor, Patch } from '@hexly/web-entity';
import { BoardStore } from './board-store';

/**
 * The EntityDocument key the embedded RichContent editor reads and writes — a private slot inside this
 * adapter, never the board's own document. A Text Block's prose is not a top-level Entity Field; it
 * lives inside a Board Element, so the editor is handed a one-key synthetic body and its writes are
 * routed back into the armed element (see {@link TextBlockSession}).
 */
export const TEXT_CONTENT_KEY = 'core.field.content';

/**
 * The {@link EntitySession} a **Text Block**'s embedded RichContent editor sees (#268) — the seam that lets a
 * Board reuse the *same editor as an Entity's RichContent* without that editor knowing it edits a Board
 * Element. It presents the armed Text Block's `core.datatype.rich-content` value as a one-Field body, and folds
 * the editor's debounced commits back through {@link BoardStore.setContent}, so a prose edit is one
 * undoable board step and rides the surface's save.
 *
 * Provided per Text Block and bound (via {@link setTarget}) to that block's id — *not* read off
 * {@link BoardStore.armed}: the editor stays mounted after a disarm (one renderer serves both faces,
 * #268) and its debounced commit can still flush then, by which point `armed` is already null — routing
 * on a stable target is what keeps the final keystrokes. It delegates permission and save-registration
 * to the real board session (injected `skipSelf`), the central store every board View edits (ADR-0048).
 */
@Injectable()
export class TextBlockSession implements EntitySession {
  private readonly store = inject(BoardStore);
  /** The real board session from the route: the source of truth for permission and the save flush. */
  private readonly base = inject(ENTITY_SESSION, { skipSelf: true });

  /** The Text Block element this session edits, bound by the host once its id is known. */
  private readonly _target = signal<string>('');

  /** Bind the element whose prose this session presents and commits — set by the hosting TextBlockComponent. */
  setTarget(id: string): void {
    this._target.set(id);
  }

  /** The target Text Block's prose, presented under {@link TEXT_CONTENT_KEY} as the editor's whole body. */
  readonly doc = computed<EntityDocument>(() => ({ [TEXT_CONTENT_KEY]: this.targetContent() }));

  /** Delegates to the real session — the embedded editor is mounted only when the board is writable. */
  readonly writable = this.base.writable;

  /**
   * The editor re-seeds when this ticks. Folds the real session's load generation (a fresh Entity
   * adoption) together with the store's {@link BoardStore.historyGeneration} (a board undo/redo): an
   * undo reverts `element.content` while the live editor still holds the pre-undo prose, and without a
   * re-seed its next debounced commit would silently un-undo. Both counters only ever increment, so
   * their sum changes whenever either does.
   */
  readonly loadGeneration = computed(() => this.base.loadGeneration() + this.store.historyGeneration());

  /** Unused by the RichContent editor; delegated so the interface is honoured. */
  readonly current = this.base.current;

  /**
   * The board Entity's own Types/Fields and their management — unused by the RichContent editor (a Text
   * Block edits prose, not the board's substance), delegated to the real session so the port is honoured
   * and any surface that did read them would see the board's, not a stub's.
   */
  readonly types = this.base.types;
  readonly fields = this.base.fields;

  setTypes(types: readonly EntityType[]): void {
    this.base.setTypes(types);
  }

  attachField(id: string): void {
    this.base.attachField(id);
  }

  detachField(id: string): void {
    this.base.detachField(id);
  }

  /**
   * Route the editor's full-doc commit into the target Text Block. The editor assigns a fresh RichContent at
   * {@link TEXT_CONTENT_KEY}; {@link BoardStore.setContent} makes that one undoable board edit. Patches
   * are irrelevant — TipTap owns its own history (ADR-0051) — so an empty patch set is returned.
   */
  mutate(recipe: (draft: EntityDocument) => void): { redo: Patch[]; undo: Patch[] } {
    const id = this._target();
    const body: EntityDocument = { [TEXT_CONTENT_KEY]: this.targetContent() };
    recipe(body);
    if (id) this.store.setContent(id, body[TEXT_CONTENT_KEY] as RichContent);
    return { redo: [], undo: [] };
  }

  /** The RichContent editor keeps its own history and never replays patches through the session — a no-op. */
  applyPatches(): void {
    /* no-op: TipTap owns the Text Block's edit history (ADR-0051). */
  }

  /** Forward to the real session so a page save flushes the Text Block's pending prose first (ADR-0051). */
  registerEditor(editor: LiveEditor): () => void {
    return this.base.registerEditor(editor);
  }

  /** The target element's prose, or an empty document when it is gone or not text-shaped. */
  private targetContent(): RichContent {
    const id = this._target();
    const element = id ? this.store.document().elements.find((e) => e.id === id) : undefined;
    return element?.kind === 'text' ? element.content : emptyRichContent();
  }
}
