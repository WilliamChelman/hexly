import type { Page } from '@playwright/test';
import { addWorldMember, enterEntities, expect, openEntity, shareOpenEntity, signInGrantee, test } from './fixtures';
import { idFromSegment } from '../../../libs/web-core/src/utils/pretty-id';

/**
 * Inline Creation inherits the Contributor gate (issue #345, ADR-0073): an Editor granted rights on one
 * Entity is no Contributor in its World, so both Create rows are absent, not present-and-failing.
 *
 * The two specs differ by exactly one `world_members` row, which is what makes the absence attributable
 * to the create standing alone.
 */

interface Shared {
  readonly worldSeg: string;
  readonly worldId: string;
  /** The note the second user writes prose in, granted to them as an Editor. */
  readonly hostId: string;
  /** The note they must still be able to link, granted to them read-only. */
  readonly targetId: string;
}

async function seedSharedNotes(page: Page): Promise<Shared> {
  const worldSeg = await enterEntities(page);
  const worldId = idFromSegment(worldSeg);

  const mint = async (name: string) => {
    const res = await page.request.post('/api/entities', { data: { name, types: ['core.type.note'], worldId } });
    expect(res.ok(), `${res.status()} ${await res.text()}`).toBeTruthy();
    return (await res.json()).id as string;
  };

  // The picker's search is reader-scoped and the grantee is no member of the World, so the Entity they
  // must still be able to link is shared with them explicitly.
  const targetId = await mint('Zorblax the Devourer');
  await openEntity(page, targetId);
  await shareOpenEntity(page, 'viewer');

  const hostId = await mint('The Chronicle');
  await openEntity(page, hostId);
  await shareOpenEntity(page, 'editor');

  return { worldSeg, worldId, hostId, targetId };
}

test('an Entity Editor with no Contributor standing gets no Create rows, and can still link a match', async ({
  page,
  browser,
}) => {
  const { worldId, hostId, targetId } = await seedSharedNotes(page);

  const editor = await signInGrantee(browser);

  // The gate is decided server-side: reachable through an Entity grant, but no `create-entity`.
  const world = await editor.request.get(`/api/worlds/${worldId}`);
  expect((await world.json()).rights).toEqual(['read']);

  await openEntity(editor, hostId);
  await editor.getByTestId('note-content').click();

  // The two Create rows would have been the whole listbox here, so their absence must leave the
  // picker's empty state rather than a blank box.
  await editor.keyboard.type('@Nothing By That Name');
  await expect(editor.getByTestId('entity-picker')).toBeVisible();
  await expect(editor.getByText('No matching entities')).toBeVisible();
  await expect(editor.getByTestId('entity-picker-create')).toHaveCount(0);
  await expect(editor.getByTestId('entity-picker-create-details')).toHaveCount(0);

  await editor.keyboard.press('Escape');
  await expect(editor.getByTestId('note-content')).toContainText('@Nothing By That Name');
  await expect(editor.getByTestId('entity-link')).toHaveCount(0);

  // Whatever they type: a name that *does* match still offers no Create beside the match.
  await editor.keyboard.type(' @Zorblax');
  await expect(editor.getByTestId(`entity-picker-option-${targetId}`)).toBeVisible();
  await expect(editor.getByTestId('entity-picker-create')).toHaveCount(0);
  await expect(editor.getByTestId('entity-picker-create-details')).toHaveCount(0);

  // Losing creation must not cost them linking.
  await editor.keyboard.press('Enter');
  const link = editor.getByTestId('entity-link');
  await expect(link).toHaveText('Zorblax the Devourer');
  expect(await link.getAttribute('data-entity-id')).toBe(targetId);

  await editor.context().close();
});

test('the same caller, made a World Contributor, is offered both Create rows again', async ({ page, browser }) => {
  const { worldSeg, worldId, hostId } = await seedSharedNotes(page);
  await addWorldMember(page, worldSeg, 'contributor');

  const contributor = await signInGrantee(browser);
  const world = await contributor.request.get(`/api/worlds/${worldId}`);
  expect((await world.json()).rights).toEqual(['read', 'create-entity']);

  await openEntity(contributor, hostId);
  await contributor.getByTestId('note-content').click();

  await contributor.keyboard.type('@Nothing By That Name');
  await expect(contributor.getByTestId('entity-picker-create')).toHaveText('Create "Nothing By That Name"');
  await expect(contributor.getByTestId('entity-picker-create-details')).toBeVisible();

  // Unchanged from #343: one keystroke on the fast path mints and links.
  await contributor.keyboard.press('Enter');
  await expect(contributor.getByTestId('entity-link')).toHaveText('Nothing By That Name');

  await contributor.context().close();
});
