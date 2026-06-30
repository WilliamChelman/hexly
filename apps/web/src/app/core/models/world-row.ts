/**
 * A raw `worlds` row as the TrailBase Record API returns it (ADR-0032): snake_case
 * columns, the UUID PK as a url-safe base64 string, epoch-second timestamps. The
 * Worlds client maps this to the camelCase domain `WorldSummary`/`WorldDetail`.
 */
export interface WorldRow {
  id: string;
  name: string;
  owner_id: string;
  created_at: number;
  updated_at: number;
}
