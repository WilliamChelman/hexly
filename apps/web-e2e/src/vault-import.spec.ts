import { strToU8, zipSync } from 'fflate';
import { expect, segRe, test } from './fixtures';

/**
 * Vault-import smoke (#149, ADR-0033). Proves the wiring end to end: the World
 * Index "Import vault" affordance uploads a `.zip`, the summary modal reports what
 * landed, opening the World shows the imported notes, an imported note's Metadata
 * is visible read-only, and a `[[wikilink]]` resolved to a clickable Entity Link.
 *
 * The vault is built in memory (fflate) — the same helper the API's import spec
 * uses — so there's no committed binary fixture.
 */
function vaultZip(): Buffer {
  return Buffer.from(
    zipSync({
      // Frontmatter → Metadata; the [[Keep]] wikilink resolves to the other note.
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
      'Keep.md': strToU8('The northern keep guards the pass.'),
    }),
  );
}

test('imports a vault from the World Index, landing in the new World with a resolved link', async ({
  page,
}) => {
  await page.goto('/');

  // Upload straight to the hidden picker (setInputFiles bypasses the click).
  const imported = page.waitForResponse(
    (r) =>
      r.url().endsWith('/api/worlds/import') &&
      r.request().method() === 'POST' &&
      r.ok(),
  );
  await page.getByTestId('import-vault-input').setInputFiles({
    name: 'Aldermoor.zip',
    mimeType: 'application/zip',
    buffer: vaultZip(),
  });
  const summary = await (await imported).json();
  expect(summary.notesImported).toBe(2);
  expect(summary.linksResolved).toBe(1);

  // The summary modal reports the import before the user enters the World (the
  // native <dialog> inside app-dialog is the visible surface — assert its button).
  await expect(page.getByTestId('open-imported')).toBeVisible();

  // Land in the new World's Entity browser, showing the imported notes.
  await page.getByTestId('open-imported').click();
  await expect(page).toHaveURL(new RegExp(`/w/${segRe(summary.worldId)}/entities$`));
  await expect(page.getByRole('link', { name: 'Mara' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Keep' })).toBeVisible();

  // Open the note carrying the wikilink; its frontmatter came across as read-only
  // Metadata, including the provenance key hexly.sourcePath.
  await page.getByRole('link', { name: 'Mara' }).click();
  await expect(page.getByTestId('title')).toHaveText('Mara');
  await expect(page.getByTestId('entity-metadata')).toContainText('hexly.sourcePath');
  await expect(page.getByTestId('entity-metadata')).toContainText('Mara.md');

  // [[Keep]] resolved to a real, navigable Entity Link (not a dangling label).
  const link = page.getByTestId('entity-link');
  await expect(link).toHaveText('Keep');
  await expect(link).not.toHaveAttribute('data-dangling', '');
  await expect(link).toHaveAttribute('href', /\/entities\/[\w-]+$/);
  await link.click();
  await expect(page.getByTestId('title')).toHaveText('Keep');
});
