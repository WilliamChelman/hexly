import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { AdminUser, CreateUserRequest } from '@hexly/domain';

/**
 * HTTP client for the Instance Admin surface (ADR-0037, #163): account management.
 * Stateless — the admin panel reads {@link list} and issues the mutations. Unlike the
 * public {@link UsersClient} directory, these rows carry the email (an Admin concern).
 * The Superadmin-only toggle lives here too; the server refuses it for a plain Admin.
 */
@Injectable({ providedIn: 'root' })
export class AdminClient {
  private readonly http = inject(HttpClient);

  list(): Observable<AdminUser[]> {
    return this.http.get<AdminUser[]>('/api/admin/users');
  }

  createUser(req: CreateUserRequest): Observable<void> {
    return this.http.post<void>('/api/admin/users', req);
  }

  setDisabled(id: string, disabled: boolean): Observable<void> {
    return this.http.patch<void>(`/api/admin/users/${id}/disabled`, { disabled });
  }

  resetPassword(id: string, password: string): Observable<void> {
    return this.http.post<void>(`/api/admin/users/${id}/password`, { password });
  }

  setAdmin(id: string, isAdmin: boolean): Observable<void> {
    return this.http.patch<void>(`/api/admin/users/${id}/admin`, { isAdmin });
  }

  setSuperadmin(id: string, isSuperadmin: boolean): Observable<void> {
    return this.http.patch<void>(`/api/admin/users/${id}/superadmin`, { isSuperadmin });
  }

  deleteUser(id: string): Observable<void> {
    return this.http.delete<void>(`/api/admin/users/${id}`);
  }
}
