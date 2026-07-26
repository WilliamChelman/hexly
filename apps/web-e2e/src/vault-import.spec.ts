import type { APIRequestContext, Page } from '@playwright/test';
import { strToU8, zipSync } from 'fflate';
import { entityIdFromUrl, expect, openDetails, segRe, test } from './fixtures';

/**
 * Vault-import smoke (ADR-0033) and the import dialog's per-run options (ADR-0073). The vault is built
 * in memory (fflate) so there's no committed binary fixture.
 */
function vaultZip(): Buffer {
  return Buffer.from(
    zipSync({
      // Frontmatter → EntityDocument; the [[Keep]] wikilink resolves to the other note.
      'Mara.md': strToU8(
        [
          '---',
          'status: canon',
          'aliases: [Lady Mara]',
          '---',
          '',
          'Lady Mara rules the northern reach. Her seat is the [[Keep]].',
        ].join('\n'),
      ),
      // [[Zorblax]] names no note, so the create-unresolved switch (on by default) mints it (ADR-0073).
      'Keep.md': strToU8('The northern keep guards the pass against [[Zorblax]].'),
    }),
  );
}

/** Pick the vault on the hidden input; `setInputFiles` bypasses the click. The dialog opens, nothing uploads. */
async function pickVault(page: Page): Promise<void> {
  await page.getByTestId('import-vault-input').setInputFiles({
    name: 'Aldermoor.zip',
    mimeType: 'application/zip',
    buffer: vaultZip(),
  });
  await expect(page.getByTestId('import-options')).toBeVisible();
}

/** Confirm the options dialog and read the import summary off the wire. */
async function confirmImport(page: Page) {
  const imported = page.waitForResponse(
    (r) => r.url().endsWith('/api/worlds/import') && r.request().method() === 'POST' && r.ok(),
  );
  await page.getByTestId('confirm-import').click();
  return (await (await imported).json()) as {
    worldId: string;
    notesImported: number;
    linksResolved: number;
    linksCreated: number;
    linksDangling: number;
  };
}

/**
 * The rendered ink of the open note's one Entity Link. Live, Unresolved and dangling must not
 * share a colour (ADR-0073); the computed value says so without pinning a class name. The
 * non-colour cues — the dash and the italic — are asserted beside it.
 */
async function colourOf(page: Page): Promise<string> {
  return page.getByTestId('entity-link').evaluate((el) => getComputedStyle(el).color);
}

/** The Entity a run minted for `[[Zorblax]]`, read back off the API — the Types and Tags it carries. */
async function mintedZorblax(request: APIRequestContext, worldId: string) {
  const found = await (await request.get(`/api/entities?worldId=${worldId}&q=Zorblax`)).json();
  expect(found.items).toHaveLength(1);
  return found.items[0] as { types: string[]; tags?: string[] };
}

test('imports a vault from the World Index, landing in the new World with a resolved link', async ({ page }) => {
  await page.goto('/');

  await pickVault(page);
  // Prefilled from the Instance defaults, so the common case needs no decision.
  await expect(page.getByTestId('import-create-unresolved')).toBeChecked();
  await expect(page.getByTestId('import-inline-type')).toHaveValue('core.type.note');
  await expect(page.getByTestId('import-inline-tag')).toHaveValue('');

  const summary = await confirmImport(page);
  expect(summary.notesImported).toBe(2);
  expect(summary.linksResolved).toBe(1);
  // The switch is on, so the unresolved name is minted.
  expect(summary.linksCreated).toBe(1);

  // The summary modal reports the import before the user enters the World (the
  // native <dialog> inside app-dialog is the visible surface — assert its button).
  await expect(page.getByTestId('open-imported')).toBeVisible();
  await expect(page.getByTestId('import-links-created')).toHaveText('1');

  // Land in the new World's Entity browser, showing the imported notes — and the minted Entity beside them.
  await page.getByTestId('open-imported').click();
  await expect(page).toHaveURL(new RegExp(`/w/${segRe(summary.worldId)}/entities$`));
  await expect(page.getByRole('link', { name: 'Mara' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Keep' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Zorblax' })).toBeVisible();

  // Open the note carrying the wikilink; its frontmatter came across as read-only
  // EntityDocument, including the provenance key hexly.sourcePath. The inline metadata
  // block is retired (ADR-0067) — those untyped keys now read from the Details panel.
  await page.getByRole('link', { name: 'Mara' }).click();
  await expect(page.getByTestId('title')).toHaveText('Mara');
  await openDetails(page);
  await expect(page.getByTestId('detail-plain')).toContainText('hexly.sourcePath');
  await expect(page.getByTestId('detail-plain')).toContainText('Mara.md');

  // [[Keep]] resolved to a real, navigable Entity Link (not a dangling label).
  const link = page.getByTestId('entity-link');
  await expect(link).toHaveText('Keep');
  await expect(link).not.toHaveAttribute('data-dangling', '');
  await expect(link).toHaveAttribute('href', /\/entities\/[\w-]+$/);
  await link.click();
  await expect(page.getByTestId('title')).toHaveText('Keep');
});

test('cancelling the options dialog uploads nothing', async ({ page }) => {
  await page.goto('/');

  let posted = false;
  page.on('request', (r) => {
    if (r.url().endsWith('/api/worlds/import')) posted = true;
  });

  await pickVault(page);
  await page.getByTestId('cancel-import').click();
  await expect(page.getByTestId('import-options')).toBeHidden();

  expect(posted).toBe(false);
  // Nothing landed, so there is no summary to dismiss either.
  await expect(page.getByTestId('import-summary')).toHaveCount(0);
});

test('the switch off creates nothing, and its Unresolved Link reads apart from a live and a dangling one', async ({
  page,
  request,
}) => {
  await page.goto('/');

  await pickVault(page);
  await page.getByTestId('import-create-unresolved').uncheck();
  const summary = await confirmImport(page);
  expect(summary.linksCreated).toBe(0);
  expect(summary.linksDangling).toBe(1);

  await page.getByTestId('open-imported').click();
  await expect(page.getByRole('link', { name: 'Keep' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Zorblax' })).toHaveCount(0);
  const browserPath = new URL(page.url()).pathname;

  // A live link, for the other two to be told apart from (ADR-0073).
  await page.getByRole('link', { name: 'Mara' }).click();
  await expect(page.getByTestId('entity-link')).toHaveAttribute('href', /\/entities\/[\w-]+$/);
  const live = await colourOf(page);

  // [[Zorblax]] matched no note, so it stayed an Unresolved Link — a name never written.
  await page.goto(browserPath);
  await page.getByRole('link', { name: 'Keep' }).click();
  await expect(page.getByTestId('title')).toHaveText('Keep');
  const unresolvedLink = page.getByTestId('entity-link');
  await expect(unresolvedLink).toHaveText('Zorblax');
  await expect(unresolvedLink).toHaveAttribute('data-unresolved', '');
  await expect(unresolvedLink).not.toHaveAttribute('data-dangling', '');
  // Non-navigable, like a dangling link: there is no id to go to.
  await expect(page.getByTestId('note-content').getByRole('link', { name: 'Zorblax' })).toHaveCount(0);
  // The dash carries the state without hue, for a reader who cannot tell the two tints apart.
  await expect(unresolvedLink).toHaveCSS('text-decoration-style', 'dashed');
  const unresolved = await colourOf(page);
  const keepId = entityIdFromUrl(page);

  // Delete Keep and Mara's resolved link dangles — the same World now carries one of each,
  // and the author must tell "never written" from "no longer there" at a glance.
  expect((await request.delete(`/api/entities/${keepId}`)).ok()).toBeTruthy();
  await page.goto(browserPath);
  await page.getByRole('link', { name: 'Mara' }).click();
  const danglingLink = page.getByTestId('entity-link');
  await expect(danglingLink).toHaveAttribute('data-dangling', '');
  await expect(danglingLink).not.toHaveAttribute('data-unresolved', '');
  await expect(danglingLink).toHaveCSS('font-style', 'italic');
  const dangling = await colourOf(page);

  expect(new Set([live, unresolved, dangling]).size).toBe(3);
});

test('the per-run Type and Tag land on what the import creates, and never reach the next run', async ({
  page,
  request,
}) => {
  await page.goto('/');

  await pickVault(page);
  await page.getByTestId('import-inline-type').selectOption('core.type.hex-map');
  // A Tag this World does not have — it is minted by this very import, so it has none.
  await page.getByTestId('import-inline-tag').fill('from-the-vault');
  const first = await confirmImport(page);
  expect(first.linksCreated).toBe(1);

  const minted = await mintedZorblax(request, first.worldId);
  expect(minted.types).toEqual(['core.type.hex-map']);
  expect(minted.tags).toEqual(['from-the-vault']);

  // Neither override survives: the next pick reads the Instance defaults again.
  await page.getByTestId('open-imported').click();
  await page.goto('/');
  await pickVault(page);
  await expect(page.getByTestId('import-create-unresolved')).toBeChecked();
  await expect(page.getByTestId('import-inline-type')).toHaveValue('core.type.note');
  await expect(page.getByTestId('import-inline-tag')).toHaveValue('');

  const second = await confirmImport(page);
  expect(second.worldId).not.toBe(first.worldId);
  const again = await mintedZorblax(request, second.worldId);
  expect(again.types).toEqual(['core.type.note']);
  expect(again.tags ?? []).toEqual([]);
});
