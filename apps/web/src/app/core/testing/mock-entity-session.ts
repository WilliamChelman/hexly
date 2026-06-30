import { computed, signal } from '@angular/core';
import { EMPTY, Observable, of } from 'rxjs';
import { Content, EntityDetail } from '@hexly/domain';

/**
 * A driveable stand-in for `EntitySession`, the facade the editor-shell components
 * (save-status, entity-header) depend on. Its persistence state is exposed as
 * writable signals a spec sets directly — `session.setConflict(server)`,
 * `session.setSaving(true)` — instead of orchestrating a real save, and its
 * commands are spies (`expect(session.reload)…`). Keeps component tests on the
 * session boundary; the session's own behaviour is covered by `entity-session.spec`.
 */
export class MockEntitySession {
  private readonly _current = signal<EntityDetail | null>(null);
  private readonly _conflict = signal<EntityDetail | null>(null);
  private readonly _seed = signal<EntityDetail | null>(null);
  private readonly _error = signal<'save' | 'reload' | null>(null);
  private readonly _content = signal<Content | null>(null);
  private readonly _tags = signal<readonly string[]>([]);
  private readonly _saving = signal(false);
  private readonly _baseDirty = signal(false);

  readonly current = this._current.asReadonly();
  readonly conflict = this._conflict.asReadonly();
  readonly seed = this._seed.asReadonly();
  readonly error = this._error.asReadonly();
  readonly content = this._content.asReadonly();
  readonly tags = this._tags.asReadonly();
  readonly saving = this._saving.asReadonly();
  readonly dirty = computed(() => this._baseDirty());

  setCurrent(detail: EntityDetail | null): void { this._current.set(detail); }
  setConflict(detail: EntityDetail | null): void { this._conflict.set(detail); }
  setSeed(detail: EntityDetail | null): void { this._seed.set(detail); }
  setError(error: 'save' | 'reload' | null): void { this._error.set(error); }
  setContent(content: Content | null): void { this._content.set(content); }
  setTags(tags: readonly string[]): void { this._tags.set(tags); }
  setSaving(saving: boolean): void { this._saving.set(saving); }
  setDirty(dirty: boolean): void { this._baseDirty.set(dirty); }

  watchRoute = vi.fn<() => void>();
  open = vi.fn<(id: string) => Observable<EntityDetail>>(() => EMPTY);
  adopt = vi.fn<(detail: EntityDetail) => void>();
  rename = vi.fn<(name: string) => Observable<EntityDetail>>(() => EMPTY);
  save = vi.fn<(showLoading?: boolean) => Observable<unknown>>(() => of(undefined));
  reload = vi.fn<() => Observable<EntityDetail>>(() => EMPTY);
  flush = vi.fn<() => Observable<unknown>>(() => of(undefined));
}
