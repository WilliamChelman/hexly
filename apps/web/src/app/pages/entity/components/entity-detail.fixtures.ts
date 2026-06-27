import { CONTENT_FORMAT, EntityDetail } from '@hexly/domain';

export const noteDetail = (name: string): EntityDetail => ({
  id: 'n1',
  ownerId: 'u1',
  name,
  type: 'note',
  tags: [],
  visibility: 'private',
  version: 1,
  createdAt: 1,
  updatedAt: 1,
  document: { type: 'note', content: { format: CONTENT_FORMAT, snapshot: {} } },
});
