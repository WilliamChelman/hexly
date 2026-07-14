/**
 * Tests for eslint-rules/plugin-seam.mjs.
 * Run: node --test eslint-rules/plugin-seam.spec.mjs  (from repo root)
 *
 * RuleTester throws on failures, so each `tester.run(...)` call is itself the assertion.
 * A rule with a typo'd selector silently matches nothing and passes CI — which is the exact
 * failure mode this seam already suffered once (ADR-0050's prose "zero hex in apps/web"), so
 * every rule here proves both that a real violation fires *and* that the near-misses stay quiet.
 *
 * The TypeScript parser is required: `no-type-definition-declaration` reads type annotations, and
 * the domain fixtures use `import type`.
 */
import { RuleTester } from 'eslint';
import { describe, it } from 'node:test';
import tseslint from 'typescript-eslint';
import pluginSeam from './plugin-seam.mjs';

const tester = new RuleTester({
  languageOptions: { parser: tseslint.parser, ecmaVersion: 2022, sourceType: 'module' },
});

describe('no-content-or-tiptap-import', () => {
  const rule = pluginSeam.rules['no-content-or-tiptap-import'];

  it("bans content- and tiptap-shaped imports, and leaves the domain's real imports alone", () => {
    tester.run('no-content-or-tiptap-import', rule, {
      valid: [
        // The domain's actual imports — zod, sibling modules, the web-entity-free neighbours.
        { code: "import { z } from 'zod'" },
        { code: "import { FieldSchema } from './field'" },
        { code: "import { entityTypeSchema } from './entity'" },
        // `core.rich-content` lives in the domain only as a *string* and in *prose*: the data-type id
        // and the comments that mention it are values, not imports, and must never trip the rule.
        { code: "const RICH_CONTENT = 'core.rich-content'" },
        { code: '/** prose reaches this loop as the core.rich-content data-type */ export const x = 1' },
        // A package that merely contains the letters "content" mid-word is not the content plugin.
        { code: "import { discontent } from 'malcontents'" },
      ],
      invalid: [
        // The content plugin — the home the seam moved to.
        {
          code: "import { CONTENT_FIELD } from '@hexly/plugin-content'",
          errors: [{ messageId: 'banned' }],
        },
        {
          code: "import { providePluginContent } from '@hexly/plugin-content/web'",
          errors: [{ messageId: 'banned' }],
        },
        // A `content/` seam clawed back into the domain by relative path.
        {
          code: "import { visit } from './content/visit'",
          errors: [{ messageId: 'banned' }],
        },
        {
          code: "import { ContentNode } from '../content-node'",
          errors: [{ messageId: 'banned' }],
        },
        // The editing engine itself, and its ProseMirror underlayer.
        {
          code: "import { Editor } from '@tiptap/core'",
          errors: [{ messageId: 'banned' }],
        },
        {
          code: "import { DOMParser } from 'prosemirror-model'",
          errors: [{ messageId: 'banned' }],
        },
        // `import type` is no escape hatch — a type-only edge is still a dependency on the shape.
        {
          code: "import type { ContentSnapshot } from '@hexly/plugin-content'",
          errors: [{ messageId: 'banned' }],
        },
        // Re-export and dynamic import reach the same modules the static import does.
        {
          code: "export { CONTENT_FIELD } from '@hexly/plugin-content'",
          errors: [{ messageId: 'banned' }],
        },
        {
          code: "export * from '@tiptap/core'",
          errors: [{ messageId: 'banned' }],
        },
        {
          code: "const load = () => import('@hexly/plugin-content/web')",
          errors: [{ messageId: 'banned' }],
        },
        {
          code: "const c = require('@tiptap/core')",
          errors: [{ messageId: 'banned' }],
        },
      ],
    });
  });
});

describe('no-type-definition-declaration', () => {
  const rule = pluginSeam.rules['no-type-definition-declaration'];

  it('bans defineType() calls', () => {
    tester.run('no-type-definition-declaration', rule, {
      valid: [
        // A same-named method on some unrelated object is not the domain's `defineType`… but the rule
        // deliberately catches `x.defineType()` too, so the only quiet member call is a *different* name.
        { code: 'registry.register(def)' },
        { code: 'const t = registry.resolve(type)' },
      ],
      invalid: [
        {
          code: "const CORE_NOTE = defineType({ id: 'core.note' })",
          errors: [{ messageId: 'defineType' }],
        },
        // A member-expression call is no escape hatch.
        {
          code: "plugin.defineType({ id: 'core.note' })",
          errors: [{ messageId: 'defineType' }],
        },
        // Two calls, two reports — the rule must not stop at the first.
        {
          code: "defineType({ id: 'a' }); defineType({ id: 'b' });",
          errors: [{ messageId: 'defineType' }, { messageId: 'defineType' }],
        },
      ],
    });
  });

  it('bans a TypeDefinition-typed binding but not holding one from the registry', () => {
    tester.run('no-type-definition-declaration', rule, {
      valid: [
        // The registry's own surface: accepting, returning, and holding definitions is the app's job —
        // it just must not *author* them. Param and return annotations are untouched.
        { code: 'function register(definition: TypeDefinition): void {}' },
        { code: 'function toDefinition(type: AvailableType): TypeDefinition { return build(type); }' },
        { code: 'function resolve(id: string): TypeDefinition | undefined { return undefined; }' },
        { code: 'function palette(defs: readonly TypeDefinition[]): Palette { return {}; }' },
        // An *inferred* local off a registry lookup carries no annotation, so it is fine — the way a
        // component actually reads a resolved type.
        { code: 'const def = registry.resolve(type)' },
        // An inferred class field, the shape TypeRegistry actually uses.
        { code: 'class Registry { defs = signal<readonly TypeDefinition[]>([]); }' },
        // Indexing into the type for its `id` string is not authoring the shape.
        { code: "const id = 'core.note' as TypeDefinition['id']" },
        // A different type entirely.
        { code: 'const schema: FieldSchema[] = []' },
      ],
      invalid: [
        // The exact shape of the deleted apps/web/entity-types/core-types.ts.
        {
          code: "const CORE_TYPE_DEFINITIONS: readonly TypeDefinition[] = [{ id: 'core.note' }]",
          errors: [{ messageId: 'declaration' }],
        },
        {
          code: "const NOTE: TypeDefinition = { id: 'core.note', views: [CORE_VIEW_CONTENT] }",
          errors: [{ messageId: 'declaration' }],
        },
        {
          code: 'const types: TypeDefinition[] = []',
          errors: [{ messageId: 'declaration' }],
        },
        // A namespaced reference is still the same type.
        {
          code: 'const t: webEntity.TypeDefinition = build()',
          errors: [{ messageId: 'declaration' }],
        },
        // A union that mentions it counts — the binding can hold an authored Type.
        {
          code: 'let active: TypeDefinition | null = null',
          errors: [{ messageId: 'declaration' }],
        },
        // The un-annotated escape hatch, closed: an `as` assertion authoring the shape.
        {
          code: "const CORE = [{ id: 'core.note' }] as TypeDefinition[]",
          errors: [{ messageId: 'declaration' }],
        },
        // A class field typed as the shape — one syntax over from the const.
        {
          code: 'class Types { readonly defs: readonly TypeDefinition[] = []; }',
          errors: [{ messageId: 'declaration' }],
        },
      ],
    });
  });
});
