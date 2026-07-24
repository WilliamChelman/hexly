import type { APIRequestContext, Page } from '@playwright/test';
import { contentViewToggle, createEntity, authorWorldType, enterLibrary, expect, flushSave, test } from './fixtures';

/** A prose View is bound to the Field it renders (ADR-0051), so each of the Saint's two afford their own. */
const CONTENT_VIEW = contentViewToggle('world.field.content');
const SECRETS_VIEW = contentViewToggle('world.field.secrets');

const LORE = 'Lady Mara rules the northern reach.';
const SECRET = 'The assassin lives in the cellar.';

/**
 * The twin of `two-grids.spec.ts` for prose: a user-defined type declaring two `core.datatype.rich-content`
 * Fields affords two content Views. What is asserted here is not that undo works (the unit specs cover
 * that) but that there are two of it — each View has its own editor and its own history, over its own
 * Field's slice, exactly as #202 gave one Entity two grids.
 */
test('an Entity with two prose Fields affords two content Views, each with its own body and undo', async ({
  page,
  request,
}) => {
  const worldId = await enterLibrary(page);
  // A distinct type id (`world.type.saint`, not `two-grids`' `world.type.deity`): the reset clears Entities but
  // not a World's authored types, so a type this spec shares with another would carry that one's Fields.
  // Prose is a Field of a Structured Data Type like the grid — added from the kind picker, at the key and under the
  // name the World Owner chose; two of them coexist as two Fields of the one EntityDocument.
  await authorWorldType(page, worldId, {
    id: 'saint',
    name: 'Saint',
    fields: [
      { segment: 'content', label: 'Content', kind: 'core.datatype.rich-content' },
      { segment: 'secrets', label: 'Secrets', kind: 'core.datatype.rich-content' },
    ],
  });

  await enterLibrary(page);
  const entityId = await createEntity(page, 'world.type.saint');

  // Two prose toggles, each named for its Field — which is what tells the public lore from the secret.
  await expect(page.getByTestId(CONTENT_VIEW)).toHaveText('Content');
  await expect(page.getByTestId(SECRETS_VIEW)).toHaveText('Secrets');

  const editor = page.getByTestId('note-content');
  await page.getByTestId(CONTENT_VIEW).click();
  await editor.click();
  await page.keyboard.type(LORE);
  await expect(editor).toContainText(LORE);

  // The `secrets` Field is its own empty body: the public lore never reached it.
  await page.getByTestId(SECRETS_VIEW).click();
  await expect(editor).not.toContainText('Lady Mara');

  await editor.click();
  await page.keyboard.type(SECRET);
  await expect(editor).toContainText(SECRET);

  // Undo on `secrets` rewinds its own text — proof its history is its own, minted with the editor that
  // owns its Field. One shared stack would offer the public lore to rewind here, or leave the secret.
  await undo(page);
  await expect(editor).not.toContainText(SECRET);

  // Re-type it, so both bodies carry prose to persist below.
  await editor.click();
  await page.keyboard.type(SECRET);

  await page.getByTestId(CONTENT_VIEW).click();
  // Neither the secret's typing nor its undo moved the public body off what was left in it.
  await expect(editor).toContainText(LORE);
  // And the secret never leaked across Fields: one editor over two keys would have shown it here.
  await expect(editor).not.toContainText('assassin');

  await flushSave(page);
  await page.reload();

  // The active View survived the reload (the URL carries its Field key with the id), and each View comes
  // back on its own body — the two differ, so a View resolving to the wrong Field could not read right.
  await expect(page.getByTestId(CONTENT_VIEW)).toHaveAttribute('aria-pressed', 'true');
  await expect(editor).toContainText(LORE);
  await page.getByTestId(SECRETS_VIEW).click();
  await expect(editor).toContainText(SECRET);

  // Two Fields of the one EntityDocument, each holding the prose typed on its own View (ADR-0051).
  const doc = await savedDocument(request, entityId);
  expect(JSON.stringify(doc['world.field.content'].snapshot)).toContain(LORE);
  expect(JSON.stringify(doc['world.field.secrets'].snapshot)).toContain(SECRET);
  // Distinct keys: the secret is not in the public body, nor the lore in the secret.
  expect(JSON.stringify(doc['world.field.content'].snapshot)).not.toContain('assassin');
  expect(JSON.stringify(doc['world.field.secrets'].snapshot)).not.toContain('Lady Mara');
});

/** Focus the open editor and rewind its history — TipTap keeps its own undo (ADR-0051); extra presses no-op. */
async function undo(page: Page): Promise<void> {
  await page.getByTestId('note-content').click();
  for (let i = 0; i < 5; i++) await page.keyboard.press('ControlOrMeta+z');
}

/** The Entity's persisted EntityDocument, fetched from the API — each prose Field a `{ format, snapshot }` value. */
async function savedDocument(
  request: APIRequestContext,
  entityId: string,
): Promise<Record<string, { format: string; snapshot: unknown }>> {
  const res = await request.get(`/api/entities/${entityId}`);
  expect(res.ok()).toBeTruthy();
  return (await res.json()).document;
}
