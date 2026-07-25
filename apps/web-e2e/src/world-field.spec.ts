import {
  attachField,
  authorWorldField,
  authorWorldType,
  createEntity,
  enterLibrary,
  expect,
  flushSave,
  openDetails,
  test,
} from './fixtures';
import { idFromSegment } from '../../../libs/web-core/src/utils/pretty-id';

/**
 * A World Owner authors a reusable `world.field.element` Field once, then attaches it to one deity but not
 * another — the headline payoff of first-class Fields (#230, mirroring `world-type-map.spec.ts`): one
 * deity has an elemental affinity, its neighbour does not, and no type was touched to say so. The same
 * Field is then reused on a plain note — one Field across two unrelated types. All management is inline
 * through the Details View/Panel (ADR-0067 — the Edit-fields dialog is retired).
 */
test('authors world.field.element, attaches it to one deity but not another, and reuses it across types', async ({
  page,
  request,
}) => {
  const worldId = await enterLibrary(page);

  // Author `world.field.element` (fire/ice/water) in the World Fields editor, and a `world.type.deity` type beside
  // it. The Fields list shows each Field's Data Type — a "Choice" for the enum.
  await authorWorldField(page, worldId, {
    segment: 'element',
    label: 'Element',
    kind: 'enum',
    options: 'fire, ice, water',
  });
  await expect(page.getByTestId('field-type-world.field.element')).toHaveText('Choice');
  await authorWorldType(page, worldId, {
    id: 'deity',
    name: 'Deity',
    fields: [{ segment: 'domain', label: 'Domain' }],
  });

  // Deity A: a scalar-only type affords no other View, so it opens full-width on the Details View. Attach
  // `world.field.element` — a Field its type never named — fill it in place, and persist.
  await enterLibrary(page);
  const pelor = await createEntity(page, 'world.type.deity');
  await expect(page.getByTestId('title')).toBeVisible();
  await attachField(page, 'world.field.element');

  const element = page.getByTestId('detail-field-world.field.element').locator('select');
  await expect(element).toBeVisible();
  await element.selectOption('fire');

  const saved = await flushSave(page);
  const body = await saved.json();
  // The `world.field.element` key's presence in the document *is* the attachment (ADR-0057) — no `fields[]`.
  expect(body.document).toMatchObject({ 'world.field.element': 'fire' });

  await page.reload();
  await openDetails(page);
  await expect(page.getByTestId('detail-field-world.field.element').locator('select')).toHaveValue('fire');

  // Deity B: no attachment. One deity carries an element, its neighbour does not — and the Field is
  // still on offer, proving deity A's choice consumed nothing.
  await enterLibrary(page);
  await createEntity(page, 'world.type.deity');
  await openDetails(page);
  await expect(page.getByTestId('detail-field-world.field.element')).toHaveCount(0);
  await expect(page.getByTestId('detail-field-add').locator('option[value="world.field.element"]')).toHaveCount(1);

  // Reuse across an unrelated type: the same `world.field.element` rides a plain `core.type.note`, whose
  // Content View means the Details management lives in the Dock Panel.
  await enterLibrary(page);
  const note = await createEntity(page, 'core.type.note');
  await attachField(page, 'world.field.element');
  await page.getByTestId('detail-field-world.field.element').locator('select').selectOption('ice');

  const savedNote = await flushSave(page);
  expect((await savedNote.json()).document).toMatchObject({ 'world.field.element': 'ice' });
  expect(pelor).not.toEqual(note); // two distinct Entities of two unrelated types, one shared Field
});

/**
 * A worldbuilder classifies their own Entity-Link Field as decor via the World field editor's "presentation
 * only" checkbox (ADR-0069, #310) — the same edge-level mechanism `core.field.thumbnail` uses. A "Portrait"
 * link then subdues on the World Graph exactly as a Thumbnail does, so its target falls out as an ordinary
 * orphan; a plain "Ally" Entity-Link Field stays a semantic, default-visible relation. The checkbox drives
 * the classification through the World field request DTOs and the ordinary harvest — no asset-specific code.
 */
test('a user Entity-Link Field flagged "presentation only" produces Decor Links; an un-flagged one stays semantic', async ({
  page,
}) => {
  const prettyWorld = await enterLibrary(page);
  const worldId = idFromSegment(prettyWorld); // the raw id the entities must be created under

  // Author two user Entity-Link Fields: "Portrait" flagged presentation-only (decor), "Ally" left semantic.
  await authorWorldField(page, prettyWorld, {
    segment: 'portrait',
    label: 'Portrait',
    kind: 'entityLink',
    decor: true,
  });
  // The code-less editor now offers the entityLink kind; the Fields list labels its Data Type.
  await expect(page.getByTestId('field-type-world.field.portrait')).toHaveText('Entity link');
  await authorWorldField(page, prettyWorld, { segment: 'ally', label: 'Ally', kind: 'entityLink' });

  // The Fields are World-scoped (#191), so the linking Entities must be created in *this* World for
  // `world.field.*` to resolve as Entity Links (and classify) at harvest — pass its raw id explicitly.
  const ally = await page.request.post('/api/entities', {
    data: { name: 'Rivertown', types: ['core.type.note'], worldId },
  });
  expect(ally.ok(), `${ally.status()} ${await ally.text()}`).toBeTruthy();
  const allyId = (await ally.json()).id as string;

  const portrait = await page.request.post('/api/entities', {
    data: { name: 'Ancestor', types: ['core.type.note'], worldId },
  });
  expect(portrait.ok(), `${portrait.status()} ${await portrait.text()}`).toBeTruthy();
  const portraitId = (await portrait.json()).id as string;

  // The source links both — Ally (semantic) and Portrait (decor) — through the two user Fields.
  const source = await page.request.post('/api/entities', {
    data: {
      name: 'Hero',
      types: ['core.type.note'],
      worldId,
      document: {
        'world.field.ally': { entityId: allyId, label: 'Rivertown' },
        'world.field.portrait': { entityId: portraitId, label: 'Ancestor' },
      },
    },
  });
  expect(source.ok(), `${source.status()} ${await source.text()}`).toBeTruthy();

  await page.goto(`/w/${prettyWorld}/graph`);

  // Default: only the semantic Ally edge draws; the decor Portrait edge is hidden, so Ancestor is an orphan and out.
  const counts = page.getByTestId('graph-counts');
  await expect(counts).toContainText('2 entities');
  await expect(counts).toContainText('1 links');

  // Reveal decor: the Portrait edge returns and Ancestor with it — proof the checkbox drove classification
  // through the DTO and the harvest, subduing only the presentation link.
  await page.getByTestId('graph-filters').click();
  const decorToggle = page.getByTestId('graph-decor-toggle');
  await expect(decorToggle).toHaveAttribute('aria-checked', 'false');
  await decorToggle.click();
  await expect(counts).toContainText('3 entities');
  await expect(counts).toContainText('2 links');
});
