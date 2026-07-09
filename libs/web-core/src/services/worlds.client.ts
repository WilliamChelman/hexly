import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable, merge, tap } from 'rxjs';
import {
  FollowSignal,
  ImportSummary,
  MemberRole,
  PublicLink,
  WorldDetail,
  WorldMember,
  WorldNudge,
  WorldSummary,
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
 * HTTP client for the worlds API. Stateless per HTTP call; also the seam that fronts the
 * live-follow store for Worlds ({@link watch}/{@link watchAll}), so callers never touch
 * {@link NudgeBusClient} directly.
 */
@Injectable({ providedIn: 'root' })
export class WorldsClient {
  private readonly http = inject(HttpClient);
  private readonly bus = inject(NudgeBusClient);
  private readonly logger = inject(Logger);
  private readonly store = new FollowStore<WorldDetail>(this.bus, {
    kind: 'world',
    debounceMs: WORLD_NUDGE_DEBOUNCE_MS,
    // A transient refetch failure leaves the Dashboard stale (self-heals on the next nudge/reconnect):
    // log it — as WorldStore does — so it isn't silently unexplained. Restores the log ActiveWorld had.
    onRefetchError: (err) => this.logger.error('Failed to refetch the active World from a nudge', err),
  });

  /**
   * Live-follow one World through the write-through store (ADR-0044): a shared, freshness-deduped
   * stream that also surfaces this tab's own rename/pin writes with no roundtrip. Emits the fresh
   * detail or `EVICTED`. A consumer applies only what it wants (e.g. drops a stale in-flight read).
   */
  watch(id: string): Observable<Watched<WorldDetail>> {
    return this.store.watch(id, () => this.read(id));
  }

  /**
   * Follow a *set* of Worlds and relay their raw nudges — for a list store that reconciles at the
   * list level (a readable nudge → refetch the list, an `unavailable` → drop that row), not the
   * per-resource refetch {@link watch} owns.
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
   * Import an Obsidian vault `.zip` into a fresh World. The browser sets the
   * multipart boundary, so we deliberately don't touch Content-Type.
   */
  importVault(file: File): Observable<ImportSummary> {
    const form = new FormData();
    form.append('file', file);
    return this.http.post<ImportSummary>('/api/worlds/import', form);
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
    return this.http
      .patch<WorldDetail>(`/api/worlds/${id}`, { pinnedEntityIds })
      .pipe(tap((d) => this.store.merge(d)));
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
    return this.http.post<WorldMember[]>(`/api/worlds/${id}/members`, { userId, role });
  }

  /** Change a member's role between Contributor and Viewer; returns the updated member set. */
  setMemberRole(id: string, userId: string, role: MemberRole): Observable<WorldMember[]> {
    return this.http.patch<WorldMember[]>(`/api/worlds/${id}/members/${userId}`, { role });
  }

  /** Remove a member, or leave the World yourself (pass your own id); returns the updated member set. */
  removeMember(id: string, userId: string): Observable<WorldMember[]> {
    return this.http.delete<WorldMember[]>(`/api/worlds/${id}/members/${userId}`);
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
