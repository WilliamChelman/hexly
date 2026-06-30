/**
 * A raw `entities` row as the TrailBase Record API returns it (ADR-0032): snake_case
 * columns, the UUID PK as a url-safe base64 string, `document` and `tags` as JSON
 * *strings*, `is_home` as 0/1, epoch-second timestamps. The Entities client maps this
 * to the camelCase domain `EntitySummary`/`EntityDetail`.
 */
export interface EntityRow {
  id: string;
  owner_id: string;
  world_id: string;
  is_home: number;
  name: string;
  type: string;
  tags: string;
  visibility: string;
  version: number;
  document: string;
  created_at: number;
  updated_at: number;
}
