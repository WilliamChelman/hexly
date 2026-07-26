import { strToU8, zipSync } from 'fflate';
import {
  confirmImport,
  entityIdFromUrl,
  expect,
  flushSave,
  importUnresolvedVault,
  openEntity,
  pickVault,
  shareOpenEntity,
  signInGrantee,
  test,
} from './fixtures';

/**
 * Promoting an Unresolved Link in place (issue #350, ADR-0073): the mention a vault carried becomes a
 * real Entity, named from the link's `label` and never its `display`, without disturbing the sentence.
 *
 * Create is an Unresolved Link's alone — a dangling one is resolver-derived, so a failed batch would let
 * a bad connection mint a duplicate — and it is a write, so it inherits the Contributor gate. The
 * read-only viewer's inert link is covered by `entity-link-repair.spec.ts`; the inline Type and Tag a
 * promotion mints under are covered by `config/inline-type.spec.ts`, which runs against a server
 * configuring them.
 */

test('an Unresolved Link promotes in place: named from its label, with its display, its heading and the prose intact', async ({
  page,
}) => {
  await importUnresolvedVault(page);

  const link = page.getByTestId('entity-link');
  await expect(link).toHaveAttribute('data-unresolved', '');
  await expect(link).toHaveText('the old wyrm');

  await link.click();
  await expect(page.getByTestId('entity-link-repair')).toBeVisible();
  // Both actions, and the Create row names the label's basename, not the prose phrasing it renders as.
  await expect(page.getByTestId('entity-link-repair-create')).toHaveText('Create "Zorblax"');
  await expect(page.getByTestId('entity-link-repair-relink')).toBeVisible();

  await page.getByTestId('entity-link-repair-create').click();
  await expect(page.getByTestId('entity-link-repair')).toHaveCount(0);

  // Live and navigable, the `[[…|display]]` override and the `#Lair` anchor both carried through.
  await expect(link).toHaveAttribute('data-entity-id', /.+/);
  const mintedId = await link.getAttribute('data-entity-id');
  await expect(link).toHaveAttribute('href', `/entities/${mintedId}#Lair`);
  await expect(link).toHaveText('the old wyrm');
  await expect(page.getByTestId('note-content')).toHaveText(
    'The northern keep guards the pass against the old wyrm, and holds.',
  );

  // The label's basename, never the display and never the path: `[[bestiary/Zorblax|the old wyrm]]`
  // names *Zorblax*, exactly as importing it with auto-creation on would have (ADR-0073).
  const minted = await (await page.request.get(`/api/entities/${mintedId}`)).json();
  expect(minted.name).toBe('Zorblax');

  // The promotion is a document write, not a render: it survives a reload.
  await flushSave(page);
  await page.reload();
  await expect(page.getByTestId('entity-link')).toHaveAttribute('href', `/entities/${mintedId}#Lair`);
  await expect(page.getByTestId('entity-link')).toHaveText('the old wyrm');
});

test('a dangling link is offered no Create, only the relink', async ({ page, request }) => {
  // Switch left on, so the import mints the Entity `[[Zorblax]]` names and the link lands live.
  await page.goto('/');
  await pickVault(page, Buffer.from(zipSync({ 'Keep.md': strToU8('The keep is held against [[Zorblax]].') })));
  const summary = await confirmImport(page);
  expect(summary.linksCreated).toBe(1);

  await page.getByTestId('open-imported').click();
  await page.getByRole('link', { name: 'Keep' }).click();
  await expect(page.getByTestId('title')).toHaveText('Keep');

  const link = page.getByTestId('entity-link');
  await expect(link).toHaveAttribute('data-entity-id', /.+/);
  const targetId = await link.getAttribute('data-entity-id');

  expect((await request.delete(`/api/entities/${targetId}`)).ok()).toBeTruthy();
  await page.reload();
  await expect(link).toHaveAttribute('data-dangling', '');

  await link.click();
  await expect(page.getByTestId('entity-link-repair')).toBeVisible();
  await expect(page.getByTestId('entity-link-repair-relink')).toBeVisible();
  await expect(page.getByTestId('entity-link-repair-create')).toHaveCount(0);
});

test('a caller with no create rights in the World is offered no Create, and can still retarget', async ({
  page,
  browser,
}) => {
  const { worldId } = await importUnresolvedVault(page);
  const keepId = entityIdFromUrl(page);

  // The picker's search is reader-scoped and the grantee is no member of the World, so the Entity they
  // must still be able to link is shared with them explicitly.
  const created = await page.request.post('/api/entities', {
    data: { name: 'Zorblax the Devourer', types: ['core.type.note'], worldId },
  });
  expect(created.ok(), `${created.status()} ${await created.text()}`).toBeTruthy();
  const targetId = (await created.json()).id as string;
  await openEntity(page, targetId);
  await shareOpenEntity(page, 'viewer');

  await openEntity(page, keepId);
  await shareOpenEntity(page, 'editor');

  const editor = await signInGrantee(browser);
  // Rights on the Entity, no Contributor standing in its World — the gate this spec attributes to.
  const world = await editor.request.get(`/api/worlds/${worldId}`);
  expect((await world.json()).rights).toEqual(['read']);

  await openEntity(editor, keepId);
  const link = editor.getByTestId('entity-link');
  await expect(link).toHaveAttribute('data-unresolved', '');

  await link.click();
  await expect(editor.getByTestId('entity-link-repair')).toBeVisible();
  await expect(editor.getByTestId('entity-link-repair-create')).toHaveCount(0);

  // Losing creation must not cost them retargeting.
  await editor.getByTestId('entity-link-repair-relink').click();
  await editor.getByTestId('entity-link-repair-picker-search').fill('Zorblax');
  await editor.getByTestId(`entity-link-repair-picker-option-${targetId}`).click();
  await expect(link).toHaveAttribute('data-entity-id', targetId);
  await expect(link).toHaveText('the old wyrm');

  await editor.context().close();
});
