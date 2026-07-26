import { strToU8, zipSync } from 'fflate';
import { expect, openDetails, segRe, test } from './fixtures';

/**
 * Vault-import smoke (ADR-0033). The vault is built in memory (fflate) so there's no
 * committed binary fixture.
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

test('imports a vault from the World Index, landing in the new World with a resolved link', async ({ page }) => {
  await page.goto('/');

  // Upload straight to the hidden picker (setInputFiles bypasses the click).
  const imported = page.waitForResponse(
    (r) => r.url().endsWith('/api/worlds/import') && r.request().method() === 'POST' && r.ok(),
  );
  await page.getByTestId('import-vault-input').setInputFiles({
    name: 'Aldermoor.zip',
    mimeType: 'application/zip',
    buffer: vaultZip(),
  });
  const summary = await (await imported).json();
  expect(summary.notesImported).toBe(2);
  expect(summary.linksResolved).toBe(1);
  // The web import sends no options, so it gets the default: the unresolved name is minted.
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
