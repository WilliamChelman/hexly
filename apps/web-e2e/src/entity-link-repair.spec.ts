import type { Page } from '@playwright/test';
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
 * Repairing a broken Entity Link in place (issue #349, ADR-0073). An import resolves wikilinks by
 * case-insensitive basename (ADR-0033), so `[[Zorblax]]` routinely misses an Entity actually named
 * "Zorblax the Devourer" — retargeting is the fix that does not mint a duplicate. Both broken
 * renderings afford it, and only for a writer.
 *
 * Seeded by a vault import, which is the only producer of an Unresolved Link (ADR-0073).
 */

/** Two notes whose wikilink resolves, so deleting the target leaves a dangling link behind. */
function resolvedVault(): Buffer {
  return Buffer.from(
    zipSync({
      'Mara.md': strToU8('Lady Mara rules the northern reach. Her seat is the [[Keep]].'),
      'Keep.md': strToU8('The northern keep guards the pass.'),
    }),
  );
}

/** Walk the popover: open it on the pill, take the relink action, then pick `targetId`. */
async function relink(page: Page, query: string, targetId: string): Promise<void> {
  await page.getByTestId('entity-link').click();
  await expect(page.getByTestId('entity-link-repair')).toBeVisible();
  await page.getByTestId('entity-link-relink').click();
  await page.getByTestId('entity-link-repair-picker-search').fill(query);
  await page.getByTestId(`entity-link-repair-picker-option-${targetId}`).click();
  await expect(page.getByTestId('entity-link-repair')).toHaveCount(0);
}

test('an Unresolved Link retargets in place, keeping its display text, its heading and the prose around it', async ({
  page,
}) => {
  const { worldId } = await importUnresolvedVault(page);

  // The Entity the import could not match: the basename is only a prefix of its name.
  const created = await page.request.post('/api/entities', {
    data: { name: 'Zorblax the Devourer', types: ['core.type.note'], worldId },
  });
  expect(created.ok(), `${created.status()} ${await created.text()}`).toBeTruthy();
  const targetId = (await created.json()).id as string;

  const link = page.getByTestId('entity-link');
  await expect(link).toHaveAttribute('data-unresolved', '');
  await expect(link).toHaveText('the old wyrm');

  // Opened by mistake, dismissed two ways, and the link is left exactly as it was.
  await link.click();
  await expect(page.getByTestId('entity-link-repair')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('entity-link-repair')).toHaveCount(0);
  await link.click();
  await page.getByTestId('note-content').click({ position: { x: 5, y: 5 } });
  await expect(page.getByTestId('entity-link-repair')).toHaveCount(0);
  await expect(link).toHaveAttribute('data-unresolved', '');

  await relink(page, 'Zorblax', targetId);

  // Live and navigable, the `[[…|display]]` override and the `#Lair` anchor both carried through.
  await expect(link).toHaveAttribute('data-entity-id', targetId);
  await expect(link).toHaveAttribute('href', `/entities/${targetId}#Lair`);
  await expect(link).toHaveText('the old wyrm');
  await expect(page.getByTestId('note-content')).toHaveText(
    'The northern keep guards the pass against the old wyrm, and holds.',
  );

  // The retarget is a document write, not a render: it survives a reload.
  await flushSave(page);
  await page.reload();
  await expect(page.getByTestId('entity-link')).toHaveAttribute('href', `/entities/${targetId}#Lair`);
  await expect(page.getByTestId('entity-link')).toHaveText('the old wyrm');
});

test('a dangling link offers the same repair, and retargeting revives it', async ({ page, request }) => {
  await page.goto('/');
  await pickVault(page, resolvedVault());
  const summary = await confirmImport(page);
  expect(summary.linksResolved).toBe(1);

  await page.getByTestId('open-imported').click();
  await expect(page.getByRole('link', { name: 'Mara' })).toBeVisible();
  const browserPath = new URL(page.url()).pathname;

  await page.getByRole('link', { name: 'Keep' }).click();
  await expect(page.getByTestId('title')).toHaveText('Keep');
  const keepId = entityIdFromUrl(page);

  // A replacement for the target about to go away — the honest fix for a connection that broke.
  const created = await page.request.post('/api/entities', {
    data: { name: 'The Ruined Keep', types: ['core.type.note'], worldId: summary.worldId },
  });
  expect(created.ok()).toBeTruthy();
  const targetId = (await created.json()).id as string;

  expect((await request.delete(`/api/entities/${keepId}`)).ok()).toBeTruthy();

  await page.goto(browserPath);
  await page.getByRole('link', { name: 'Mara' }).click();
  const link = page.getByTestId('entity-link');
  await expect(link).toHaveAttribute('data-dangling', '');

  await relink(page, 'Ruined', targetId);

  await expect(link).toHaveAttribute('data-entity-id', targetId);
  await expect(link).toHaveAttribute('href', `/entities/${targetId}`);
  // The stored label is replaced by the new target's name, and the sentence is otherwise untouched.
  await expect(page.getByTestId('note-content')).toHaveText(
    'Lady Mara rules the northern reach. Her seat is the The Ruined Keep.',
  );
});

test('a read-only viewer sees an inert link and is offered no repair', async ({ page, browser }) => {
  await importUnresolvedVault(page);
  const keepId = entityIdFromUrl(page);
  await shareOpenEntity(page, 'viewer');

  const viewer = await signInGrantee(browser);
  await openEntity(viewer, keepId);

  const link = viewer.getByTestId('entity-link');
  await expect(link).toHaveAttribute('data-unresolved', '');
  // Not even reachable by keyboard: a write they cannot perform is never offered (ADR-0073).
  await expect(link).not.toHaveAttribute('role', 'button');

  await link.click();
  await expect(viewer.getByTestId('entity-link-repair')).toHaveCount(0);
  // Nor the Create the same link offers a writer (#350): no popover means no action in it.
  await expect(viewer.getByTestId('entity-link-repair-create')).toHaveCount(0);

  await viewer.context().close();
});
