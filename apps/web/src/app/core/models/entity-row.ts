import { EntityBody } from '@hexly/domain';

/**
 * A raw `entities` row as the TrailBase Record API returns it (ADR-0032): snake_case
 * columns, the UUID PK as a url-safe base64 string, `is_home` as 0/1, epoch-second
 * timestamps. `tags` is a JSON *string*; `document` is a jsonschema-typed JSON column
 * (#130) so the API returns it already parsed as an object — though writes send, and the
 * test fake returns, a string, so the mapper tolerates both. The Entities client maps
 * this to the camelCase domain `EntitySummary`/`EntityDetail`.
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
  document: string | EntityBody;
  created_at: number;
  updated_at: number;
}
