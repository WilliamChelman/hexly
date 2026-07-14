/**
 * The prose data-type *with* its Markdown converter — the registration only the **API** bundles (ADR-0051).
 * Its own module, off the framework-free barrel and reached only through `@hexly/plugin-content/server`
 * (ADR-0053), because the converter drags in the `unified`/`remark`/`yaml` toolchain (~160 kB) that only a
 * vault import/export runs; the web registers the converter-free {@link RICH_CONTENT_DATA_TYPE} instead.
 */

import { defineStructuredDataType, type VaultExportContext, type VaultImportContext } from '@hexly/domain';
import { ContentNode, visit } from './content-node';
import { Content, tiptapContent } from './content';
import { markdownToProseMirror } from './markdown-to-prose-mirror';
import { proseMirrorToMarkdown } from './prose-mirror-to-markdown';
import { richContentBase } from './rich-content';

/** The base capabilities plus the `body` **Vault Projection** and its Markdown converter. */
export const RICH_CONTENT_DATA_TYPE_VAULT = /* @__PURE__ */ defineStructuredDataType({
  ...richContentBase,
  vault: {
    slot: 'body',
    toMarkdown: proseToBody,
    fromMarkdown: bodyToProse,
  },
});

/**
 * Serialize a Content value to its Markdown body block. Works on a clone so the stored snapshot is never
 * mutated: each inline **Entity Link**'s wikilink label is refreshed to its target's CURRENT name (so a
 * post-import rename still round-trips) and each image src is repointed at its exported Asset path — both
 * resolved through the {@link VaultExportContext}, never a DB the converter can't reach. A value this
 * build cannot read as Content serializes as an empty document rather than throwing.
 */
function proseToBody(content: Content | undefined, ctx: VaultExportContext): string {
  const snapshot = structuredClone(content?.snapshot ?? { type: 'doc', content: [] }) as ContentNode;
  visit(snapshot, (node) => {
    if (node.type === 'entityLink' && node.attrs) {
      const current = ctx.entityName(String(node.attrs['entityId'] ?? ''));
      if (current) node.attrs['label'] = current;
    } else if (node.type === 'image' && node.attrs) {
      const mapped = ctx.assetPath(String(node.attrs['src'] ?? ''));
      if (mapped) node.attrs['src'] = mapped;
    }
  });
  return proseMirrorToMarkdown(snapshot);
}

/**
 * Parse a Markdown body block back into a Content value. Runs the pure {@link markdownToProseMirror}
 * converter, then resolves through the {@link VaultImportContext}: each `[[wikilink]]`'s label to an
 * `entityId` (a blank label is a same-note anchor — left unresolved and uncounted), each vault-relative
 * image src to its stored capability URL, and every construct with no native node reported as degraded.
 */
function bodyToProse(markdown: string, ctx: VaultImportContext): Content {
  const { doc, degraded } = markdownToProseMirror(markdown);
  for (const [construct, n] of Object.entries(degraded)) ctx.degrade(construct, n);
  visit(doc, (node) => {
    if (node.type === 'entityLink' && node.attrs) {
      const label = String(node.attrs['label'] ?? '');
      if (label) node.attrs['entityId'] = ctx.resolveLink(label);
    } else if (node.type === 'image' && node.attrs) {
      const url = ctx.storeAsset(String(node.attrs['src'] ?? ''));
      if (url) node.attrs['src'] = url;
    }
  });
  return tiptapContent(doc);
}
