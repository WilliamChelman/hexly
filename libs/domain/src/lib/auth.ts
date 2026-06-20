/**
 * Auth contracts shared by the API and the web client (ADR-0001). The closed
 * user set logs in with email + password; the session itself rides in an
 * HttpOnly cookie, so it never appears in these payloads (ADR-0004).
 */

import { z } from 'zod';

/** The current user as surfaced by login and `GET /auth/me`. Never the hash. */
export interface AuthUser {
  readonly id: string;
  readonly email: string;
  readonly displayName: string;
}

/**
 * The body of `POST /auth/login`. Both fields must be present and non-empty;
 * the email is otherwise unconstrained — a malformed address simply matches no
 * user rather than being a distinct error (ADR-0004 — credentials are opaque).
 */
export const loginRequestSchema = z.object({
  email: z.string().min(1),
  password: z.string().min(1),
});

/** A validated login submission. */
export type LoginRequest = z.infer<typeof loginRequestSchema>;
