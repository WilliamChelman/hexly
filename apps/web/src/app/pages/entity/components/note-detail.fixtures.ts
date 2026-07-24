import { EntityDetail } from '@hexly/domain';
import { CONTENT_FORMAT, CORE_NOTE } from '@hexly/plugin-content';

export const noteDetail = (name: string): EntityDetail => ({
  id: 'n1',
  worldId: 'w1',
  name,
  types: [CORE_NOTE],
  tags: [],
  visibility: 'private',
  version: 1,
  seq: 1,
  createdAt: 1,
  updatedAt: 1,
  // Owner opener by default (ADR-0039): the `edit` Right keeps the editor writable.
  rights: ['read', 'edit', 'delete', 'set-visibility', 'manage'],
  document: { content: { format: CONTENT_FORMAT, snapshot: {} } },
});
