/**
 * The write choke points, enforced (ADR-0045).
 *
 * `EntityWrites` is the single write handle for `entities` and `entity_grants`; `WorldWrites` and
 * `CompendiumWrites` are its peers for the two kinds of Container (ADR-0078) and their satellites.
 * Each owns the `seq` bump and the post-commit nudge, so a write *cannot* land without telling the
 * resource's live-followers to refetch — or evicting them. `WorldWrites` additionally fans a
 * membership change out to the World's `shared` Entities, whose Rights derive from that membership set.
 *
 * That property is only real if nothing else writes those tables:
 *
 *   no-direct-entity-writes    — `insert|update|delete` on `entities` / `entityGrants`, and raw SQL
 *                                writing those tables, outside EntityWrites itself.
 *   no-direct-container-writes — the same for the shared `containers` identity table and the
 *                                `compendiums` satellite, outside the two Container handles.
 *   no-direct-world-writes     — the same for the World-only tables, outside WorldWrites itself.
 *
 * `containers` takes a rule of its own because both kinds write it: one identity table, two
 * kind-specific handles. Splitting it out is what keeps `worlds` and `world_members` shut to
 * everything but `WorldWrites`, rather than opening the World's tables to whoever writes a Compendium.
 *
 * Scope is set by the consuming config (apps/api/eslint.config.mjs), which exempts specs — they
 * seed fixtures directly and follow nobody.
 */

/** The drizzle mutation verbs. `select`/`from` are reads and stay open. */
const WRITE_METHODS = new Set(['insert', 'update', 'delete']);

/** The literal text of a string or a template literal with no interpolation. */
function staticText(node) {
  if (node.type === 'Literal') return typeof node.value === 'string' ? node.value : null;
  if (node.type === 'TemplateLiteral' && node.expressions.length === 0)
    return node.quasis.map((q) => q.value.cooked ?? '').join('');
  return null;
}

/**
 * Build the guard for one choke point.
 *
 * @param tables       drizzle table identifiers whose every change must bump `seq` and nudge.
 *                     Siblings that cascade with the guarded row (`entityDescriptors`,
 *                     `entityEdges`, `entityLinks`, `worldLinks`) carry no freshness key and are
 *                     open — a change to them rides its owner's `seq` bump.
 * @param sqlTables    the same tables as raw SQL names, since raw SQL (`db.$client.prepare(...)`)
 *                     escapes the drizzle selector entirely.
 * @param ownerFiles   paths of the modules that *are* the write handle; exempt from the rule. More
 *                     than one only where a table is shared by two handles (`containers`).
 * @param handle       the write handle's name, for the message.
 * @param entryPoints  its public methods, named so the message says where to go instead.
 */
function chokePoint({ tables, sqlTables, ownerFiles, handle, entryPoints }) {
  const guarded = new Set(tables);
  const rawWrite = new RegExp(`\\b(INSERT\\s+INTO|UPDATE|DELETE\\s+FROM)\\s+["\`']?(${sqlTables.join('|')})\\b`, 'i');
  const messages = {
    direct: `Route this through ${handle}: it owns the \`seq\` bump and the post-commit nudge, so a write to \`{{table}}\` cannot land without refreshing or evicting its live-followers (ADR-0045).`,
    rawSql: `Raw SQL writing \`{{table}}\` bypasses ${handle}, which owns the \`seq\` bump and the post-commit nudge (ADR-0045). Use ${entryPoints}.`,
  };

  return {
    meta: {
      type: 'problem',
      docs: {
        description: `Only ${handle} may write ${tables.join(' and ')} (ADR-0045).`,
      },
      schema: [],
      messages,
    },
    create(context) {
      const filename = context.filename ?? context.getFilename?.() ?? '';
      // The write handle itself may of course write its own tables.
      if (ownerFiles.some((owner) => filename.endsWith(owner))) return {};
      return {
        CallExpression(node) {
          // `db.update(entities)`, `tx.delete(entityGrants)` — the receiver is irrelevant, so a
          // transaction handle is no escape hatch.
          const { callee } = node;
          if (
            callee.type === 'MemberExpression' &&
            callee.property.type === 'Identifier' &&
            WRITE_METHODS.has(callee.property.name)
          ) {
            const [table] = node.arguments;
            if (table?.type === 'Identifier' && guarded.has(table.name)) {
              context.report({
                node,
                messageId: 'direct',
                data: { table: table.name },
              });
              return;
            }
          }
          // Raw SQL: any statically-known string argument that writes a guarded table.
          for (const arg of node.arguments) {
            const text = staticText(arg);
            const match = text && rawWrite.exec(text);
            if (match) {
              context.report({
                node: arg,
                messageId: 'rawSql',
                data: { table: match[2] },
              });
              return;
            }
          }
        },
      };
    },
  };
}

const noDirectEntityWrites = chokePoint({
  tables: ['entities', 'entityGrants'],
  sqlTables: ['entities', 'entity_grants'],
  ownerFiles: ['entity-writes.ts'],
  handle: 'EntityWrites',
  entryPoints: '`EntityWrites.mutate`, `insert`, `cascadeDeleteWorld`, `bumpWorldShared`, or `purgeGrantsOf`',
});

const noDirectContainerWrites = chokePoint({
  // `containers` holds every Container's `seq` since ADR-0078 — a World's and a Compendium's alike —
  // so it is the one guarded table with two handles (ADR-0079).
  tables: ['containers', 'compendiums'],
  sqlTables: ['containers', 'compendiums'],
  ownerFiles: ['world-writes.ts', 'compendium-writes.ts'],
  handle: 'WorldWrites (a World) or CompendiumWrites (a Compendium)',
  entryPoints: '`WorldWrites.mint`, `update`, `delete`, or `CompendiumWrites.install` / `uninstall`',
});

const noDirectWorldWrites = chokePoint({
  tables: ['worlds', 'worldMembers', 'worldTypes', 'worldFields'],
  sqlTables: ['worlds', 'world_members', 'world_types', 'world_fields'],
  ownerFiles: ['world-writes.ts'],
  handle: 'WorldWrites',
  entryPoints:
    '`WorldWrites.mint`, `update`, `delete`, `membership`, `purgeMembershipsOf`, `createType`, `updateType`, `deleteType`, `createField`, `updateField`, or `deleteField`',
});

export default {
  rules: {
    'no-direct-entity-writes': noDirectEntityWrites,
    'no-direct-container-writes': noDirectContainerWrites,
    'no-direct-world-writes': noDirectWorldWrites,
  },
};
