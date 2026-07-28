import { enterEntities, expect, test } from './fixtures';
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
 * Decor Links on the World Graph, end to end over the single-origin build (ADR-0009, ADR-0069, #307): the
 * graph subdues presentation edges by default so worldbuilding relations aren't drowned in image plumbing.
 *
 * Ealdred links Riverbend in prose (semantic) and designates an image Asset as its Thumbnail (decor). By
 * default the decor edge is hidden, so the Asset — its only edge decor — falls out as an ordinary orphan
 * with no asset-specific code. The "show decor links" reveal restores the edge and the Asset with it; the
 * orphans toggle, independently, surfaces the Asset as an isolated node while its decor edge stays hidden.
 */
test('hides Decor Links by default and reveals them behind the show-decor toggle', async ({ page }) => {
  const prettyWorld = await enterEntities(page);
  const worldId = idFromSegment(prettyWorld); // the raw id the asset upload keys on

  // The Thumbnail target: a real image Asset, minted through the ordinary upload path.
  const uploaded = await page.request.post(`/api/worlds/${worldId}/assets`, {
    multipart: { file: { name: 'crest.png', mimeType: 'image/png', buffer: PNG_20x8 } },
  });
  expect(uploaded.ok(), `${uploaded.status()} ${await uploaded.text()}`).toBeTruthy();
  const assetId = (await uploaded.json()).id as string;

  // A semantic target, so the source is never itself an orphan and the graph always has one real relation.
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

  await page.goto(`/w/${prettyWorld}/graph`);

  // Default: the semantic pair draws; the decor Thumbnail edge is hidden, so the Asset is an orphan and out.
  const counts = page.getByTestId('graph-counts');
  await expect(counts).toContainText('2 entities');
  await expect(counts).toContainText('1 links');

  // Both reveals live in the graph's floating filters menu, which closes on select — one open per flip.
  const filters = page.getByTestId('graph-filters');
  await filters.click();
  await expect(page.getByTestId('graph-decor-toggle')).toHaveAttribute('aria-checked', 'false');

  // Reveal decor: the Thumbnail edge returns, and the Asset with it — no longer an orphan, drawn connected.
  await page.getByTestId('graph-decor-toggle').click();
  await expect(counts).toContainText('3 entities');
  await expect(counts).toContainText('2 links');

  // Hide decor again; the orphans toggle alone surfaces the Asset as an isolated node — its edge stays decor.
  await filters.click();
  await expect(page.getByTestId('graph-decor-toggle')).toHaveAttribute('aria-checked', 'true');
  await page.getByTestId('graph-decor-toggle').click();
  await expect(counts).toContainText('2 entities');
  await filters.click();
  await page.getByTestId('graph-orphans-toggle').click();
  await expect(counts).toContainText('3 entities');
  await expect(counts).toContainText('1 links');
});

/**
 * A curatorial act counts even against an Asset (ADR-0069): a Board **Embed** is always semantic, so an
 * Asset deliberately embedded on a Board stays on the graph by default — unlike a Thumbnail or a prose
 * image, which are decor. This is the asymmetry the "Embed of an Asset is semantic" rule buys.
 */
test('keeps a Board-Embedded Asset on the graph by default (Embed is semantic)', async ({ page }) => {
  const prettyWorld = await enterEntities(page);
  const worldId = idFromSegment(prettyWorld);

  const uploaded = await page.request.post(`/api/worlds/${worldId}/assets`, {
    multipart: { file: { name: 'sigil.png', mimeType: 'image/png', buffer: PNG_20x8 } },
  });
  expect(uploaded.ok(), `${uploaded.status()} ${await uploaded.text()}`).toBeTruthy();
  const assetId = (await uploaded.json()).id as string;

  // A Board embedding the Asset — a semantic edge Board → Asset, harvested at the surface Field's value.
  const board = await page.request.post('/api/entities', {
    data: {
      name: 'Untitled board',
      types: ['core.type.board'],
      document: {
        'core.field.surface': {
          elements: [
            {
              id: 'embed-1',
              kind: 'embed',
              position: { x: 0, y: 0 },
              size: { width: 480, height: 360 },
              z: 0,
              targetEntityId: assetId,
              viewInstance: '',
            },
          ],
        },
      },
    },
  });
  expect(board.ok(), `${board.status()} ${await board.text()}`).toBeTruthy();

  await page.goto(`/w/${prettyWorld}/graph`);

  // Default (decor hidden): the Board and the Asset both draw, joined by the semantic Embed edge. The
  // Embed is not decor, so there is nothing for the show-decor toggle to reveal.
  const counts = page.getByTestId('graph-counts');
  await expect(counts).toContainText('2 entities');
  await expect(counts).toContainText('1 links');
  // Nothing hidden — no decor edge, no orphan — so the filters menu has nothing to offer and stays away.
  await expect(page.getByTestId('graph-filters')).toHaveCount(0);
});
