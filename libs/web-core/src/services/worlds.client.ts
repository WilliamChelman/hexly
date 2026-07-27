import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable, merge, tap } from 'rxjs';
import {
  AvailableType,
  CreateUserDefinedTypeRequest,
  CreateWorldFieldRequest,
  Field,
  FollowSignal,
  ImporterSummary,
  ImportRunSummary,
  ImportSummary,
  MemberRole,
  PublicLink,
  UpdateUserDefinedTypeRequest,
  UpdateWorldFieldRequest,
  UserDefinedType,
  VaultImportOptions,
  Visibility,
  WorldDetail,
  WorldGraph,
  WorldMember,
  WorldNudge,
  WorldSummary,
  WorldThemeInput,
} from '@hexly/domain';
import { NudgeBusClient } from './nudge-bus.client';
import { FollowStore } from './follow-store';
import { Watched } from './live-follow';
import { Logger } from './logger';

/**
 * Trailing-debounce window before a readable World nudge triggers a refetch, so a burst of
 * changes (e.g. a pin reorder) coalesces into a single authoritative read.
 */
export const WORLD_NUDGE_DEBOUNCE_MS = 150;

/**
 * HTTP client for the worlds API. Stateless per HTTP call; also fronts the live-follow store for
 * Worlds ({@link watch}/{@link watchAll}) — callers never touch {@link NudgeBusClient} directly.
 */
@Injectable({ providedIn: 'root' })
export class WorldsClient {
  private readonly http = inject(HttpClient);
  private readonly bus = inject(NudgeBusClient);
  private readonly logger = inject(Logger);
  private readonly store = new FollowStore<WorldDetail>(this.bus, {
    kind: 'world',
    debounceMs: WORLD_NUDGE_DEBOUNCE_MS,
    // A transient refetch failure leaves the Dashboard stale; it self-heals on the next nudge/reconnect.
    onRefetchError: (err) => this.logger.error('Failed to refetch the active World from a nudge', err),
  });

  /**
   * Live-follow one World through the write-through store (ADR-0044): a shared, freshness-deduped
   * stream that also surfaces this tab's own rename/pin writes with no roundtrip. Emits the fresh
   * detail or `EVICTED`.
   */
  watch(id: string): Observable<Watched<WorldDetail>> {
    return this.store.watch(id, () => this.read(id));
  }

  /**
   * Follow a *set* of Worlds and relay their raw nudges, for a caller that reconciles at the list
   * level (readable nudge → refetch the list, `unavailable` → drop that row). No per-resource
   * refetch, unlike {@link watch}.
   */
  watchAll(ids: string[]): Observable<FollowSignal> {
    return merge(...ids.map((id) => this.bus.follow({ kind: 'world', id })));
  }

  list(): Observable<WorldSummary[]> {
    return this.http.get<WorldSummary[]>('/api/worlds');
  }

  // Server mints an empty World.
  create(name: string): Observable<WorldDetail> {
    return this.http.post<WorldDetail>('/api/worlds', { name });
  }

  /**
   * Import an Obsidian vault `.zip` into a fresh World. Don't set Content-Type — the browser must
   * set the multipart boundary itself.
   *
   * `options` is this run's create-unresolved switch and Type/Tag overrides (ADR-0073), carried as
   * plain multipart text fields. Omitting it — or leaving the Type blank — falls back to the
   * Instance's own `entities.inlineType`/`entities.inlineTag` server-side.
   *
   * The Tag rides even when empty, because emptying the prefilled control is itself the instruction
   * *no tag*: withholding the field would read as "no override" and hand the run the Instance's Tag,
   * which is the one thing a this-run override then couldn't express (ADR-0073).
   */
  importVault(file: File, options?: VaultImportOptions): Observable<ImportSummary> {
    const form = new FormData();
    form.append('file', file);
    if (options) {
      form.append('createUnresolved', String(options.createUnresolved));
      if (options.inlineType) form.append('inlineType', options.inlineType);
      form.append('inlineTag', options.inlineTag ?? '');
    }
    return this.http.post<ImportSummary>('/api/worlds/import', form);
  }

  /**
   * The World Graph: every readable Entity of the World, and the links between them, in one payload.
   * Outside the live-follow store — a `world` nudge says nothing about whether its Entities' links
   * moved — so it only refreshes when the page is opened.
   */
  graph(id: string): Observable<WorldGraph> {
    return this.http.get<WorldGraph>(`/api/worlds/${id}/graph`);
  }

  /** Raw read — the store's own refetch source (the store seeds its held from it directly). */
  private read(id: string): Observable<WorldDetail> {
    return this.http.get<WorldDetail>(`/api/worlds/${id}`);
  }

  // Write-through: a load seeds the store's held version, so the first nudge after opening dedups a
  // self-echo, and fans the fresh detail to any other watcher.
  get(id: string): Observable<WorldDetail> {
    return this.read(id).pipe(tap((d) => this.store.merge(d)));
  }

  /**
   * Export a World to a `.zip` of markdown + assets. The caller saves the blob as
   * a download; the filename is derived from the World's name, not a header.
   */
  exportVault(id: string): Observable<Blob> {
    return this.http.get(`/api/worlds/${id}/export`, { responseType: 'blob' });
  }

  // Write-through: the renamed detail feeds the store, so other watchers see it with no roundtrip
  // and this tab's own echo nudge dedups.
  rename(id: string, name: string): Observable<WorldDetail> {
    return this.http.patch<WorldDetail>(`/api/worlds/${id}`, { name }).pipe(tap((d) => this.store.merge(d)));
  }

  /**
   * Replace the World's Pinned Entities wholesale: add, remove, and reorder all
   * collapse to "send the new ordered array". Owner-gated server-side.
   */
  setPins(id: string, pinnedEntityIds: string[]): Observable<WorldDetail> {
    // Write-through, as {@link rename} — a pin reorder fans out and its echo dedups.
    return this.http.patch<WorldDetail>(`/api/worlds/${id}`, { pinnedEntityIds }).pipe(tap((d) => this.store.merge(d)));
  }

  /**
   * Replace the World Theme wholesale (ADR-0076); `null` clears it, putting the World back on the
   * Hexly default. Owner-gated server-side, and canonicalised there — a Theme is untrusted input, so
   * this client sends the Owner's own notation and stores whatever the choke point re-serialises.
   */
  setTheme(id: string, theme: WorldThemeInput | null): Observable<WorldDetail> {
    // Write-through, as {@link rename} — the saved Theme fans out and this tab's own echo dedups.
    return this.http.patch<WorldDetail>(`/api/worlds/${id}`, { theme }).pipe(tap((d) => this.store.merge(d)));
  }

  delete(id: string): Observable<void> {
    return this.http.delete<void>(`/api/worlds/${id}`);
  }

  /** The World's ownership set — Owner user ids. Owner-only server-side. */
  owners(id: string): Observable<string[]> {
    return this.http.get<string[]>(`/api/worlds/${id}/owners`);
  }

  /** Add a co-Owner; returns the updated set. Idempotent (200), not a create. */
  addOwner(id: string, userId: string): Observable<string[]> {
    return this.http.post<string[]>(`/api/worlds/${id}/owners`, { userId });
  }

  /** Remove an Owner or resign your own ownership; returns the updated set. */
  removeOwner(id: string, userId: string): Observable<string[]> {
    return this.http.delete<string[]>(`/api/worlds/${id}/owners/${userId}`);
  }

  /** The World's non-owner members — Contributors and Viewers. Owner-only server-side. */
  members(id: string): Observable<WorldMember[]> {
    return this.http.get<WorldMember[]>(`/api/worlds/${id}/members`);
  }

  /** Add a Contributor or World Viewer; returns the updated member set. Upsert (200), not a create. */
  addMember(id: string, userId: string, role: MemberRole): Observable<WorldMember[]> {
    return this.http.post<WorldMember[]>(`/api/worlds/${id}/members`, {
      userId,
      role,
    });
  }

  /** Change a member's role between Contributor and Viewer; returns the updated member set. */
  setMemberRole(id: string, userId: string, role: MemberRole): Observable<WorldMember[]> {
    return this.http.patch<WorldMember[]>(`/api/worlds/${id}/members/${userId}`, { role });
  }

  /** Remove a member, or leave the World yourself (pass your own id); returns the updated member set. */
  removeMember(id: string, userId: string): Observable<WorldMember[]> {
    return this.http.delete<WorldMember[]>(`/api/worlds/${id}/members/${userId}`);
  }

  /** The Entity Types available in a World (#191): plugin + user-defined. Reachable-gated server-side. */
  availableTypes(id: string): Observable<AvailableType[]> {
    return this.http.get<AvailableType[]>(`/api/worlds/${id}/types`);
  }

  /** Author a new user-defined type; returns the created type. World-Owner-only server-side. */
  createType(id: string, req: CreateUserDefinedTypeRequest): Observable<UserDefinedType> {
    return this.http.post<UserDefinedType>(`/api/worlds/${id}/types`, req);
  }

  /** Rename / re-Field a user-defined type; returns the updated type. World-Owner-only server-side. */
  updateType(id: string, typeId: string, patch: UpdateUserDefinedTypeRequest): Observable<UserDefinedType> {
    return this.http.patch<UserDefinedType>(`/api/worlds/${id}/types/${typeId}`, patch);
  }

  /** Delete a user-defined type. World-Owner-only server-side. */
  deleteType(id: string, typeId: string): Observable<void> {
    return this.http.delete<void>(`/api/worlds/${id}/types/${typeId}`);
  }

  /** The World's user-defined Fields (#230): the resolver and attach picker source. Reachable-gated server-side. */
  fields(id: string): Observable<Field[]> {
    return this.http.get<Field[]>(`/api/worlds/${id}/fields`);
  }

  /** Author a new World-defined Field; returns the created Field. World-Owner-only server-side. */
  createField(id: string, req: CreateWorldFieldRequest): Observable<Field> {
    return this.http.post<Field>(`/api/worlds/${id}/fields`, req);
  }

  /** Re-body a World-defined Field; returns the updated Field. World-Owner-only server-side. */
  updateField(id: string, fieldId: string, patch: UpdateWorldFieldRequest): Observable<Field> {
    return this.http.patch<Field>(`/api/worlds/${id}/fields/${fieldId}`, patch);
  }

  /** Delete a World-defined Field. World-Owner-only server-side. */
  deleteField(id: string, fieldId: string): Observable<void> {
    return this.http.delete<void>(`/api/worlds/${id}/fields/${fieldId}`);
  }

  /** The Importers available for this World (ADR-0060) — the generic Imports panel's source. Owner-only server-side. */
  importers(id: string): Observable<ImporterSummary[]> {
    return this.http.get<ImporterSummary[]>(`/api/worlds/${id}/importers`);
  }

  /** Run (or reimport) an Importer, landing its Entities at the chosen Visibility; returns at once (202), then poll {@link importStatus}. */
  runImport(id: string, importerId: string, visibility: Visibility): Observable<ImportRunSummary> {
    return this.http.post<ImportRunSummary>(`/api/worlds/${id}/importers/${importerId}/run`, { visibility });
  }

  /** Where this World's one import run stands — the poll target while a reconcile is in flight, plus the last finished run. */
  importStatus(id: string): Observable<ImportRunSummary> {
    return this.http.get<ImportRunSummary>(`/api/worlds/${id}/import/status`);
  }

  /** Remove an Importer's whole set from this World (no recreate); hand-authored Entities are left intact. Owner-only server-side. */
  removeImporter(id: string, importerId: string): Observable<void> {
    return this.http.delete<void>(`/api/worlds/${id}/importers/${importerId}`);
  }

  /** The World's Public Link — the active token or null. Owner-only server-side. */
  link(id: string): Observable<PublicLink | null> {
    return this.http.get<PublicLink | null>(`/api/worlds/${id}/link`);
  }

  /** Mint (or return the existing) World Public Link; idempotent (200). */
  mintLink(id: string): Observable<PublicLink> {
    return this.http.post<PublicLink>(`/api/worlds/${id}/link`, {});
  }

  /** Revoke the World Public Link — the kill-switch. */
  revokeLink(id: string): Observable<void> {
    return this.http.delete<void>(`/api/worlds/${id}/link`);
  }
}
