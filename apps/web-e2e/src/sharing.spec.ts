import { type APIRequestContext } from '@playwright/test';
import { expect, loginAs, test } from './fixtures';
import { CONTRIBUTOR, GRANTEE, OUTSIDER, TEST_USER, VIEWER } from './test-user';

/**
 * Share cascade + entity grants (#131, ADR-0024, ADR-0004). The World-cascade and
 * entity-level grants are enforced server-side by declarative SQL access-rules — the
 * thing the retired NestJS server never did (owner-scoped only). These specs drive the
 * TrailBase Record APIs directly as each role (Owner / Contributor / World Viewer /
 * entity grantee / non-member), asserting external behaviour — who can read or write
 * which Entity — not the shape of any access-rule (ADR-0009). The account-less World
 * Public Link is the one role not here: a READ rule can't validate a per-request token,
 * so it was split out to #138.
 *
 * `TEST_USER` is the World Owner. The auto reset (fixtures) clears the Owner's Worlds
 * between tests, and `world_id`/`entity_id` cascades drop the memberships and grants with
 * them — so every test builds its own World from scratch and leaks nothing to the next.
 */

const DOC =
  '{"type":"note","content":{"format":"tiptap-v2","snapshot":{"type":"doc","content":[]}}}';

/** A TrailBase user id is the `sub` of its auth JWT — the same encoding the Record APIs use. */
function userId(token: string): string {
  const payload = token.split('.')[1];
  return JSON.parse(Buffer.from(payload, 'base64url').toString()).sub as string;
}

/** The id TrailBase returns from a Record-API create (single-row create → `ids[0]`). */
function createdId(body: { ids?: string[]; id?: string }): string {
  return body.ids?.[0] ?? (body.id as string);
}

async function createWorld(api: APIRequestContext, owner: string, name: string): Promise<string> {
  const res = await api.post('/api/records/v1/worlds', {
    headers: { authorization: `Bearer ${owner}` },
    data: { name },
  });
  expect(res.ok(), `create world: ${res.status()}`).toBeTruthy();
  return createdId(await res.json());
}

async function createEntity(
  api: APIRequestContext,
  token: string,
  worldId: string,
  opts: { name: string; visibility?: 'private' | 'shared' },
): Promise<{ status: number; id?: string }> {
  const res = await api.post('/api/records/v1/entities', {
    headers: { authorization: `Bearer ${token}` },
    data: { world_id: worldId, name: opts.name, type: 'note', visibility: opts.visibility ?? 'private', document: DOC },
  });
  return { status: res.status(), id: res.ok() ? createdId(await res.json()) : undefined };
}

async function addMember(
  api: APIRequestContext,
  owner: string,
  worldId: string,
  member: string,
  role: 'contributor' | 'viewer',
): Promise<void> {
  const res = await api.post('/api/records/v1/world_members', {
    headers: { authorization: `Bearer ${owner}` },
    data: { world_id: worldId, user_id: userId(member), role },
  });
  expect(res.ok(), `add ${role}: ${res.status()}`).toBeTruthy();
}

async function grant(
  api: APIRequestContext,
  owner: string,
  entityId: string,
  grantee: string,
  role: 'editor' | 'viewer',
): Promise<void> {
  const res = await api.post('/api/records/v1/entity_grants', {
    headers: { authorization: `Bearer ${owner}` },
    data: { entity_id: entityId, user_id: userId(grantee), role },
  });
  expect(res.ok(), `grant ${role}: ${res.status()}`).toBeTruthy();
}

const readEntity = (api: APIRequestContext, token: string, id: string) =>
  api.get(`/api/records/v1/entities/${encodeURIComponent(id)}`, {
    headers: { authorization: `Bearer ${token}` },
  });

const updateEntity = (api: APIRequestContext, token: string, id: string, version: number) =>
  api.patch(`/api/records/v1/entities/${encodeURIComponent(id)}`, {
    headers: { authorization: `Bearer ${token}` },
    data: { document: DOC, version },
  });

const readWorld = (api: APIRequestContext, token: string, id: string) =>
  api.get(`/api/records/v1/worlds/${encodeURIComponent(id)}`, {
    headers: { authorization: `Bearer ${token}` },
  });

test('a Contributor and a World Viewer read shared Entities in their World; a private one stays hidden', async ({
  request,
}) => {
  const owner = await loginAs(request, TEST_USER);
  const contributor = await loginAs(request, CONTRIBUTOR);
  const viewer = await loginAs(request, VIEWER);

  const worldId = await createWorld(request, owner, 'Aldermoor');
  const shared = (await createEntity(request, owner, worldId, { name: 'Town', visibility: 'shared' })).id!;
  const secret = (await createEntity(request, owner, worldId, { name: 'Secret', visibility: 'private' })).id!;
  await addMember(request, owner, worldId, contributor, 'contributor');
  await addMember(request, owner, worldId, viewer, 'viewer');

  // Both members read the shared Entity — and get the real row, not just a 200.
  for (const member of [contributor, viewer]) {
    const res = await readEntity(request, member, shared);
    expect(res.ok()).toBeTruthy();
    expect((await res.json()).name).toBe('Town');
  }

  // The private Entity is hidden from the members — the visibility gate keeps unrevealed lore out.
  for (const member of [contributor, viewer]) {
    expect((await readEntity(request, member, secret)).ok()).toBeFalsy();
  }
});

test('a Contributor creates Entities and owns them; a World Viewer and a non-member cannot create', async ({
  request,
}) => {
  const owner = await loginAs(request, TEST_USER);
  const contributor = await loginAs(request, CONTRIBUTOR);
  const viewer = await loginAs(request, VIEWER);
  const outsider = await loginAs(request, OUTSIDER);

  const worldId = await createWorld(request, owner, 'Aldermoor');
  await addMember(request, owner, worldId, contributor, 'contributor');
  await addMember(request, owner, worldId, viewer, 'viewer');

  // The Contributor creates an Entity and owns it — they can read their own private creation.
  const created = await createEntity(request, contributor, worldId, { name: 'Mine' });
  expect(created.status).toBe(200);
  expect((await readEntity(request, contributor, created.id!)).ok()).toBeTruthy();

  // A World Viewer and a non-member are refused.
  expect((await createEntity(request, viewer, worldId, { name: 'No' })).status).toBe(403);
  expect((await createEntity(request, outsider, worldId, { name: 'No' })).status).toBe(403);
});

test('non-disclosure: a private Entity owned by someone else is indistinguishable from a missing one', async ({
  request,
}) => {
  const owner = await loginAs(request, TEST_USER);
  const outsider = await loginAs(request, OUTSIDER);

  const worldId = await createWorld(request, owner, 'Aldermoor');
  const secret = (await createEntity(request, owner, worldId, { name: 'Secret', visibility: 'private' })).id!;

  // A real-but-forbidden Entity and a never-existed id must answer identically — no ownership/existence leak.
  const forbidden = await readEntity(request, outsider, secret);
  const missing = await readEntity(request, outsider, 'AZ8ZjJyid1CPXsubugAAAA==');
  expect(forbidden.ok()).toBeFalsy();
  expect(forbidden.status()).toBe(missing.status());
});

test('an entity-level Viewer grant reads a private Entity but cannot edit it', async ({ request }) => {
  const owner = await loginAs(request, TEST_USER);
  const grantee = await loginAs(request, GRANTEE);

  const worldId = await createWorld(request, owner, 'Aldermoor');
  // A private Entity, and the grantee is NOT a World member — only the grant reaches it.
  const secret = (await createEntity(request, owner, worldId, { name: 'Secret', visibility: 'private' })).id!;
  expect((await readEntity(request, grantee, secret)).ok()).toBeFalsy();

  await grant(request, owner, secret, grantee, 'viewer');
  const res = await readEntity(request, grantee, secret);
  expect(res.ok()).toBeTruthy();
  expect((await res.json()).name).toBe('Secret');

  // A Viewer grant is read-only.
  expect((await updateEntity(request, grantee, secret, 1)).status()).toBe(403);
});

test('an entity-level Editor grant edits a private Entity, guarded by version', async ({ request }) => {
  const owner = await loginAs(request, TEST_USER);
  const grantee = await loginAs(request, GRANTEE);

  const worldId = await createWorld(request, owner, 'Aldermoor');
  const secret = (await createEntity(request, owner, worldId, { name: 'Secret', visibility: 'private' })).id!;
  await grant(request, owner, secret, grantee, 'editor');

  // The Editor saves under the base version it read (1); the trigger then advances the counter.
  expect((await updateEntity(request, grantee, secret, 1)).status()).toBe(200);
  // A second save at the now-stale base version is rejected by the optimistic-concurrency rule.
  expect((await updateEntity(request, grantee, secret, 1)).status()).toBe(403);
});

test('a non-member reaches neither the World nor its Entities; a member reaches the World', async ({
  request,
}) => {
  const owner = await loginAs(request, TEST_USER);
  const contributor = await loginAs(request, CONTRIBUTOR);
  const outsider = await loginAs(request, OUTSIDER);

  const worldId = await createWorld(request, owner, 'Aldermoor');
  const shared = (await createEntity(request, owner, worldId, { name: 'Town', visibility: 'shared' })).id!;
  await addMember(request, owner, worldId, contributor, 'contributor');

  // A member can read the World record (so the Index/switcher can list it); a non-member cannot.
  expect((await readWorld(request, contributor, worldId)).ok()).toBeTruthy();
  expect((await readWorld(request, outsider, worldId)).ok()).toBeFalsy();
  // And a non-member reaches none of its Entities, shared or otherwise.
  expect((await readEntity(request, outsider, shared)).ok()).toBeFalsy();
});

test('the World Owner can edit a Contributor-owned Entity', async ({ request }) => {
  const owner = await loginAs(request, TEST_USER);
  const contributor = await loginAs(request, CONTRIBUTOR);

  const worldId = await createWorld(request, owner, 'Aldermoor');
  await addMember(request, owner, worldId, contributor, 'contributor');
  const theirs = (await createEntity(request, contributor, worldId, { name: 'Mine' })).id!;

  // ADR-0024: the World Owner may edit any Entity in their World, even one they don't own.
  expect((await updateEntity(request, owner, theirs, 1)).status()).toBe(200);
});
