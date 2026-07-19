import { Result } from 'neverthrow';

/**
 * Thin neverthrow wrappers over the browser APIs that throw on the sad path —
 * `JSON.parse` on a malformed payload, `localStorage` under private mode / a
 * disabled storage quota. Each turns the throw into a `Result` so callers branch
 * on a value (`.map`/`.match`) or degrade with `.unwrapOr(...)`, keeping the raw
 * try/catch out of the call sites (first neverthrow use on the web side, #249).
 */

/** Parse JSON into `T`, or an `Err` carrying the `SyntaxError` — never throws. */
export function safeJsonParse<T>(text: string): Result<T, unknown> {
  return Result.fromThrowable(
    () => JSON.parse(text) as T,
    (e) => e,
  )();
}

/** Read a localStorage key, `Ok(null)` when absent; `Err` only when storage itself throws. */
export function safeStorageGet(key: string): Result<string | null, unknown> {
  return Result.fromThrowable(
    () => localStorage.getItem(key),
    (e) => e,
  )();
}

/** Write a localStorage key; `Err` when storage throws (private mode, quota). */
export function safeStorageSet(key: string, value: string): Result<void, unknown> {
  return Result.fromThrowable(
    () => localStorage.setItem(key, value),
    (e) => e,
  )();
}

/** Remove a localStorage key; `Err` when storage throws. */
export function safeStorageRemove(key: string): Result<void, unknown> {
  return Result.fromThrowable(
    () => localStorage.removeItem(key),
    (e) => e,
  )();
}
