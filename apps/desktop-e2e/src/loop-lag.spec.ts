import { strToU8, zipSync } from 'fflate';
import { expect, test } from './desktop-app';

/**
 * The event-loop lag tripwire in the one place it needs a shell: a main process that is also the API
 * (ADR-0070, #329). Which window a block is attributed to is settled against a driven clock in the unit
 * spec; what only a launch can show is that main watches its own loop and names the request holding it.
 *
 * A vault import is the workload because it is the offender ADR-0036 measured — `unzipSync` and one
 * synchronous write transaction, with no yield anywhere in it.
 */

/** ADR-0036's shape, so this run is comparable to the baseline recorded in ADR-0070. */
const NOTES = 1200;

function vaultZip(): Buffer {
  const files: Record<string, Uint8Array> = {};
  for (let i = 0; i < NOTES; i++) {
    files[`Note ${i}.md`] = strToU8(
      [
        '---',
        'status: canon',
        `aliases: [Alias ${i}]`,
        '---',
        '',
        `Note ${i} borders [[Note ${(i + 1) % NOTES}]] and [[Note ${(i + 7) % NOTES}]].`,
        '',
        // Enough prose that the archive is worth inflating, which is half of what the import blocks on.
        ...Array.from({ length: 20 }, (_, p) => `Paragraph ${p}. ${'lorem ipsum dolor sit amet '.repeat(3)}`),
      ].join('\n'),
    );
  }
  return Buffer.from(zipSync(files));
}

test('main reports the event-loop lag a vault import causes, naming the import', async ({ launch }) => {
  const run = await launch();
  await run.window.getByTestId('import-vault').waitFor();

  const imported = run.window.waitForResponse(
    (r) => r.url().endsWith('/api/worlds/import') && r.request().method() === 'POST',
  );
  await run.window
    .getByTestId('import-vault-input')
    .setInputFiles({ name: 'Baseline.zip', mimeType: 'application/zip', buffer: vaultZip() });
  expect((await (await imported).json()).notesImported).toBe(NOTES);

  // Polled: a block is only reported at the sample that closes the window it happened in, so the line arrives
  // up to a sample interval after the response does. Named anywhere in the suspects, not first — which of two
  // sufficient explanations reads first is the unit spec's fact, not this one's.
  await expect
    .poll(() => run.output(), { timeout: 15_000 })
    .toMatch(/event-loop lag \d+ms peak in \d+ms — [^\n]*POST \/api\/worlds\/import \d+ms/);
});
