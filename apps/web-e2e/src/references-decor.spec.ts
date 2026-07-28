import { enterEntities, expect, openEntity, test } from './fixtures';
import { idFromSegment } from '../../../libs/web-core/src/utils/pretty-id';

// A real 20×8 solid-color PNG: the ordinary upload path mints an image Asset from it (ADR-0065).
const PNG_20x8 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAABQAAAAICAIAAAB2/0i6AAAACXBIWXMAAAPoAAAD6AG1e1JrAAAAFUlEQVQYlWOwyTtBNmIY1XxiiAQYACBM50E1XKcYAAAAAElFTkSuQmCC',
  'base64',
);

/** A tiptap doc whose one paragraph carries a prose Entity Link to `entityId` — a semantic edge. */
function proseLinking(entityId: string, label: string) {
  return {
    format: 'tiptap-v3',
    snapshot: {
      type: 'doc',
      content: [{ type: 'paragraph', content: [{ type: 'entityLink', attrs: { entityId, label } }] }],
    },
  };
}

/**
 * The References panel splits relation from usage over the single-origin build (ADR-0009, ADR-0069, #309).
 *
 * Ealdred links Riverbend in prose (semantic) and designates an image Asset as its Thumbnail (decor). The
 * **outbound** "References" section — a relation surface — shows only the semantic link by default and hides
 * the Thumbnail behind an ephemeral reveal; the reveal restores it, marked. The Asset's **inbound**
 * "Referenced by" — a usage surface — lists Ealdred unconditionally, decor visually marked, no reveal needed.
 */
test('outbound References hides a Thumbnail decor link behind a reveal; the Asset’s usage lists it, marked', async ({
  page,
}) => {
  const prettyWorld = await enterEntities(page);
  const worldId = idFromSegment(prettyWorld); // the raw id the asset upload keys on

  const uploaded = await page.request.post(`/api/worlds/${worldId}/assets`, {
    multipart: { file: { name: 'crest.png', mimeType: 'image/png', buffer: PNG_20x8 } },
  });
  expect(uploaded.ok(), `${uploaded.status()} ${await uploaded.text()}`).toBeTruthy();
  const assetId = (await uploaded.json()).id as string;

  const target = await page.request.post('/api/entities', {
    data: { name: 'Riverbend', types: ['core.type.note'] },
  });
  expect(target.ok(), `${target.status()} ${await target.text()}`).toBeTruthy();
  const targetId = (await target.json()).id as string;

  // The source: a semantic prose link to Riverbend, plus a decor Thumbnail designating the Asset (ADR-0066).
  const source = await page.request.post('/api/entities', {
    data: {
      name: 'Ealdred',
      types: ['core.type.note'],
      document: {
        'core.field.content': proseLinking(targetId, 'Riverbend'),
        'core.field.thumbnail': { entityId: assetId, label: 'crest' },
      },
    },
  });
  expect(source.ok(), `${source.status()} ${await source.text()}`).toBeTruthy();
  const sourceId = (await source.json()).id as string;

  // --- Outbound (relation surface) -----------------------------------------------------------------
  await openEntity(page, sourceId);
  await page.getByTestId('references-toggle').click();

  // Default: only the semantic link shows; the decor Thumbnail is hidden.
  const outbound = page.getByTestId('reference-out');
  await expect(outbound).toHaveCount(1);
  await expect(outbound).toContainText('Riverbend');

  // The reveal is offered (there is decor to show) and starts collapsed.
  const reveal = page.getByTestId('references-decor-toggle');
  await expect(reveal).toHaveAttribute('aria-pressed', 'false');

  // Reveal: the Thumbnail joins the list, marked as decor.
  await reveal.click();
  await expect(reveal).toHaveAttribute('aria-pressed', 'true');
  await expect(outbound).toHaveCount(2);
  await expect(page.getByTestId('reference-out').getByTestId('reference-decor-mark')).toHaveCount(1);

  // Collapsing again subdues it — the reveal is ephemeral, not a sticky mode.
  await reveal.click();
  await expect(outbound).toHaveCount(1);

  // --- Inbound (usage surface) ---------------------------------------------------------------------
  // The panel choice is remembered per user (it is page chrome), so it stays open across the hop to the
  // Asset — no second toggle, which would merely close it.
  await openEntity(page, assetId);

  // The Asset's usage lists Ealdred unconditionally — no reveal — with the decor mark distinguishing a
  // mere Thumbnail designation from a semantic prose mention.
  const inbound = page.getByTestId('reference-in');
  await expect(inbound).toHaveCount(1);
  await expect(inbound).toContainText('Ealdred');
  await expect(inbound.getByTestId('reference-decor-mark')).toHaveCount(1);
  // A usage surface never hides usage, so it offers no reveal control of its own.
  await expect(page.getByTestId('references-decor-toggle')).toHaveCount(0);
});

/**
 * The usage-aware delete confirmation (ADR-0065) keeps counting decor references (ADR-0069, #309): deleting
 * an Asset still warns about the pages that merely display it, so a Thumbnail designation is never a silent
 * break. The Asset Browser's delete affordance opens the same confirmation the browser card does.
 */
test('deleting an Asset counts its decor references in the usage confirmation', async ({ page }) => {
  const prettyWorld = await enterEntities(page);
  const worldId = idFromSegment(prettyWorld);

  const uploaded = await page.request.post(`/api/worlds/${worldId}/assets`, {
    multipart: { file: { name: 'portrait.png', mimeType: 'image/png', buffer: PNG_20x8 } },
  });
  expect(uploaded.ok(), `${uploaded.status()} ${await uploaded.text()}`).toBeTruthy();
  const assetId = (await uploaded.json()).id as string;

  // A Note whose only tie to the Asset is a decor Thumbnail designation.
  const deity = await page.request.post('/api/entities', {
    data: {
      name: 'Vashenka',
      types: ['core.type.note'],
      document: { 'core.field.thumbnail': { entityId: assetId, label: 'portrait' } },
    },
  });
  expect(deity.ok(), `${deity.status()} ${await deity.text()}`).toBeTruthy();

  // Reach the Asset's delete affordance through the Asset Browser and open the confirmation.
  await page.getByTestId('nav-assets').click();
  await page.waitForURL(/\/w\/[\w-]+\/assets$/);
  await page.getByTestId(`asset-delete-${assetId}`).click();

  // The confirmation counts the decor Thumbnail reference — the display-only Note is named as usage.
  await expect(page.getByTestId('delete-usage-item')).toContainText('Vashenka');
});
