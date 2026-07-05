import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { ImportSummary, MemberRole, PublicLink, WorldDetail, WorldMember, WorldSummary } from '@hexly/domain';

/**
 * HTTP client for the worlds API (ADR-0024). Stateless: every call is a round
 * trip. The active-World selection lives in {@link WorldStore}, not here.
 */
@Injectable({ providedIn: 'root' })
export class WorldsClient {
  private readonly http = inject(HttpClient);

  list(): Observable<WorldSummary[]> {
    return this.http.get<WorldSummary[]>('/api/worlds');
  }

  // Server mints the Home Entity atomically.
  create(name: string): Observable<WorldDetail> {
    return this.http.post<WorldDetail>('/api/worlds', { name });
  }

  /**
   * Import an Obsidian vault `.zip` into a fresh World (ADR-0033). Multipart under
   * the `file` field the server expects; the browser sets the multipart boundary,
   * so we deliberately don't touch Content-Type. Returns the {@link ImportSummary}.
   */
  importVault(file: File): Observable<ImportSummary> {
    const form = new FormData();
    form.append('file', file);
    return this.http.post<ImportSummary>('/api/worlds/import', form);
  }

  get(id: string): Observable<WorldDetail> {
    return this.http.get<WorldDetail>(`/api/worlds/${id}`);
  }

  /**
   * Export a World to a `.zip` of markdown + assets (ADR-0033, #150). The response is
   * a binary blob (`responseType: 'blob'`), which the caller saves as a download; the
   * filename is derived from the World's name rather than parsed from a header.
   */
  exportVault(id: string): Observable<Blob> {
    return this.http.get(`/api/worlds/${id}/export`, { responseType: 'blob' });
  }

  rename(id: string, name: string): Observable<WorldDetail> {
    return this.http.patch<WorldDetail>(`/api/worlds/${id}`, { name });
  }

  delete(id: string): Observable<void> {
    return this.http.delete<void>(`/api/worlds/${id}`);
  }

  /** The World's ownership set — Owner user ids (ADR-0037, #158). Owner-only server-side. */
  owners(id: string): Observable<string[]> {
    return this.http.get<string[]>(`/api/worlds/${id}/owners`);
  }

  /** Add a co-Owner; returns the updated set. Idempotent (200), not a create. */
  addOwner(id: string, userId: string): Observable<string[]> {
    return this.http.post<string[]>(`/api/worlds/${id}/owners`, { userId });
  }

  /** Remove an Owner or resign your own ownership; returns the updated set (ADR-0037). */
  removeOwner(id: string, userId: string): Observable<string[]> {
    return this.http.delete<string[]>(`/api/worlds/${id}/owners/${userId}`);
  }

  /** The World's non-owner members — Contributors and Viewers (ADR-0037, #159). Owner-only server-side. */
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

  /** The World's Public Link — the active token or null (ADR-0037, #162). Owner-only server-side. */
  link(id: string): Observable<PublicLink | null> {
    return this.http.get<PublicLink | null>(`/api/worlds/${id}/link`);
  }

  /** Mint (or return the existing) World Public Link; idempotent (200). */
  mintLink(id: string): Observable<PublicLink> {
    return this.http.post<PublicLink>(`/api/worlds/${id}/link`, {});
  }

  /** Revoke the World Public Link — the kill-switch (ADR-0037, #162). */
  revokeLink(id: string): Observable<void> {
    return this.http.delete<void>(`/api/worlds/${id}/link`);
  }
}
