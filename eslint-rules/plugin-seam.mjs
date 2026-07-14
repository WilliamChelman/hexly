/**
 * The plugin seam, enforced (ADR-0051).
 *
 * ADR-0051 collapsed Content into a Structured Field and shipped the Note as `libs/plugin-content`,
 * leaving two boundaries whose whole point is that they *stay* boundaries:
 *
 *   no-content-or-tiptap-import — `libs/domain` imports nothing content- or tiptap-shaped. The
 *                                 `content/` seam, the markdown↔ProseMirror converter, `CONTENT_FIELD`
 *                                 and the `core.note` type all left the domain for the plugin; the
 *                                 domain now knows prose only as the opaque `core.rich-content`
 *                                 data-type, reached through the registry like a grid.
 *   no-type-definition-declaration — `apps/web` declares no Entity Type and calls no `defineType()`.
 *                                 The one View it names is the generic `core.view.fields` fallback,
 *                                 which is genuinely the app's; every other Type and View is a
 *                                 plugin's. `apps/web/entity-types/core-types.ts` — the last
 *                                 `TypeDefinition[]` the app authored — is gone.
 *
 * The seam has drifted shut before as a prose-only claim (ADR-0050's "zero hex in `apps/web`"); these
 * rules make drift a build failure. Scope is set by the consuming config, which exempts specs (they
 * hand-build fakes and import the converter under test), as the other repo rules do.
 */

/** The literal text of a string, or a template literal with no interpolation. */
function staticText(node) {
  if (!node) return null;
  if (node.type === 'Literal') return typeof node.value === 'string' ? node.value : null;
  if (node.type === 'TemplateLiteral' && node.expressions.length === 0)
    return node.quasis.map((q) => q.value.cooked ?? '').join('');
  return null;
}

/**
 * Classify an import source as content, tiptap, or neither.
 *
 * `content` is matched as a package/path segment (`@hexly/plugin-content`, `./content/visit`,
 * `../content-node`) rather than as a bare substring, so an unrelated identifier could never trip it;
 * `tiptap` and `prosemirror` match anywhere, since every `@tiptap/*` and `prosemirror-*` module is the
 * editing engine the domain must not reach. The domain imports none of these today.
 */
function classifySource(source) {
  if (typeof source !== 'string') return null;
  if (/tiptap|prosemirror/i.test(source)) return 'tiptap';
  if (/(^|[/@-])content([/-]|$)/i.test(source)) return 'content';
  return null;
}

const noContentOrTiptapImport = {
  meta: {
    type: 'problem',
    docs: {
      description:
        'Disallow content- or tiptap-shaped imports in libs/domain — prose is the opaque `core.rich-content` data-type here (ADR-0051).',
    },
    schema: [],
    messages: {
      banned:
        'libs/domain must not import `{{source}}`: Content ships as `@hexly/plugin-content`, and the domain knows prose only as the `core.rich-content` data-type reached through the registry, exactly as it reaches a grid (ADR-0051).',
    },
  },
  create(context) {
    function checkSource(sourceNode, reportNode) {
      const source = staticText(sourceNode);
      if (classifySource(source))
        context.report({ node: reportNode ?? sourceNode, messageId: 'banned', data: { source } });
    }
    return {
      // `import … from 'x'`, `export … from 'x'`, `export * from 'x'`.
      ImportDeclaration: (node) => checkSource(node.source, node),
      ExportNamedDeclaration: (node) => node.source && checkSource(node.source, node),
      ExportAllDeclaration: (node) => checkSource(node.source, node),
      // `import('x')` — the dynamic form the static one cannot see.
      ImportExpression: (node) => checkSource(node.source, node),
      // `require('x')` — no ESM escape hatch.
      CallExpression(node) {
        if (node.callee.type === 'Identifier' && node.callee.name === 'require') checkSource(node.arguments[0], node);
      },
    };
  },
};

/**
 * Does a type annotation reference the `TypeDefinition` type anywhere — bare, arrayed, `readonly`,
 * unioned, or namespaced (`ns.TypeDefinition`)? A recursive walk, because `readonly TypeDefinition[]`
 * — the exact shape the deleted `CORE_TYPE_DEFINITIONS` carried — nests the reference two levels down.
 */
function referencesTypeDefinition(node) {
  if (!node) return false;
  switch (node.type) {
    case 'TSTypeAnnotation':
      return referencesTypeDefinition(node.typeAnnotation);
    case 'TSTypeReference': {
      const name = node.typeName;
      if (name.type === 'Identifier') return name.name === 'TypeDefinition';
      if (name.type === 'TSQualifiedName') return name.right.name === 'TypeDefinition';
      return false;
    }
    case 'TSArrayType':
      return referencesTypeDefinition(node.elementType);
    case 'TSTypeOperator': // `readonly T[]`, `keyof T`
    case 'TSParenthesizedType':
      return referencesTypeDefinition(node.typeAnnotation);
    case 'TSUnionType':
    case 'TSIntersectionType':
      return node.types.some(referencesTypeDefinition);
    default:
      return false;
  }
}

const noTypeDefinitionDeclaration = {
  meta: {
    type: 'problem',
    docs: {
      description:
        "Disallow declaring a TypeDefinition or calling defineType() in apps/web — every Entity Type and View is a plugin's (ADR-0051).",
    },
    schema: [],
    messages: {
      // A `defineType()` call is a code-registered Entity Type — a plugin's job. The app registers none.
      defineType:
        'apps/web must not call `defineType()`: every Entity Type is declared by a plugin, not the app (ADR-0051).',
      // A variable bound to a `TypeDefinition` is the app authoring a Type — the shape of the deleted
      // `core-types.ts`. The registry hands the app definitions through its methods; the app declares none.
      declaration:
        'apps/web must not declare a `TypeDefinition`: it names no Entity Type and no View but the generic `core.view.fields`. Types come from plugins, resolved through the registry (ADR-0051).',
    },
  },
  create(context) {
    return {
      CallExpression(node) {
        const { callee } = node;
        const isDefineType =
          (callee.type === 'Identifier' && callee.name === 'defineType') ||
          (callee.type === 'MemberExpression' &&
            callee.property.type === 'Identifier' &&
            callee.property.name === 'defineType');
        if (isDefineType) context.report({ node, messageId: 'defineType' });
      },
      // `const CORE: readonly TypeDefinition[] = [ … ]` — a binding *typed* as a TypeDefinition. A
      // function that *returns* one (the user-type projection `toDefinition`) or *accepts* one (the
      // registry's `register`) is untouched: those hold a plugin's Type, they do not author one.
      VariableDeclarator(node) {
        if (node.id.type === 'Identifier' && referencesTypeDefinition(node.id.typeAnnotation)) {
          context.report({ node, messageId: 'declaration' });
        }
      },
      // A class field typed as a TypeDefinition — `readonly defs: TypeDefinition[] = [ … ]` — is the
      // same authoring, one syntax over. (An *inferred* field like `signal<TypeDefinition[]>([])`
      // carries no annotation and is untouched.)
      PropertyDefinition(node) {
        if (referencesTypeDefinition(node.typeAnnotation)) context.report({ node, messageId: 'declaration' });
      },
      // The un-annotated escape hatch: `[{ id: 'core.note' }] as TypeDefinition[]`. `TypeDefinition['id']`
      // — a string type, not the shape — is a TSIndexedAccessType `referencesTypeDefinition` ignores.
      TSAsExpression(node) {
        if (referencesTypeDefinition(node.typeAnnotation)) context.report({ node, messageId: 'declaration' });
      },
    };
  },
};

export default {
  rules: {
    'no-content-or-tiptap-import': noContentOrTiptapImport,
    'no-type-definition-declaration': noTypeDefinitionDeclaration,
  },
};
