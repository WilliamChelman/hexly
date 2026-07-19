import { describe, expect, it } from 'vitest';
import { gzipSync } from 'fflate';
import { AJAX_MONSTER_FIXTURE, GOBLIN_MONSTER_FIXTURE } from '../testing';
import { FetchLike, githubTarballFetchPort, MONSTERS_TARBALL_URL } from './monster-fetch-port';

/** One tar file entry as the builder writes it — a ustar path (split into prefix/name) and its JSON body. */
interface Entry {
  path: string;
  json: unknown;
}

const encoder = new TextEncoder();

/** Write a ustar 512-byte header + padded content per entry. Only the fields `readTar` reads are set. */
function tarball(entries: readonly Entry[]): Uint8Array {
  const blocks: Uint8Array[] = [];
  for (const entry of entries) {
    const body = encoder.encode(JSON.stringify(entry.json));
    blocks.push(header(entry.path, body.length));
    const padded = new Uint8Array(Math.ceil(body.length / 512) * 512);
    padded.set(body);
    blocks.push(padded);
  }
  blocks.push(new Uint8Array(1024)); // two trailing zero blocks mark end-of-archive
  return concat(blocks);
}

/** A ustar header carrying name/prefix (split at a `/` so name ≤ 100), the octal size, and a regular-file typeflag. */
function header(path: string, size: number): Uint8Array {
  const block = new Uint8Array(512);
  let name = path;
  let prefix = '';
  if (name.length > 100) {
    const cut = name.lastIndexOf('/', 100);
    prefix = name.slice(0, cut);
    name = name.slice(cut + 1);
  }
  block.set(encoder.encode(name.slice(0, 100)), 0);
  block.set(encoder.encode(size.toString(8).padStart(11, '0')), 124); // 11 octal digits, NUL-terminated by the zero fill
  block[156] = '0'.charCodeAt(0); // regular file
  block.set(encoder.encode('ustar\0'), 257);
  block.set(encoder.encode(prefix.slice(0, 155)), 345);
  return block;
}

function concat(chunks: readonly Uint8Array[]): Uint8Array {
  const total = chunks.reduce((n, c) => n + c.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.length;
  }
  return out;
}

/** A `FetchLike` that serves a fixed gzipped-tarball body, asserting the pinned URL is the one requested. */
function fetchServing(gz: Uint8Array, ok = true, status = 200): FetchLike {
  return async (url) => {
    expect(url).toBe(MONSTERS_TARBALL_URL);
    return { ok, status, statusText: ok ? 'OK' : 'Not Found', arrayBuffer: async () => gz.buffer as ArrayBuffer };
  };
}

/** The production fetch port's archive path (ADR-0061): gunzip + untar + Monsters-pack filter, no network. */
describe('githubTarballFetchPort', () => {
  const root = 'draw-steel-86c23ef1473fdc6fc67e4e30ed0d610cc98aaa4a';

  it('gunzips, untars, and returns only the Monsters-pack npc actor docs', async () => {
    const gz = gzipSync(
      tarball([
        {
          path: `${root}/src/packs/monsters/Ajax_the_Invincible_1duzR7U5imjJBje4/npc_Ajax_the_Invincible_DZKCzrvXRPBUjUJf.json`,
          json: AJAX_MONSTER_FIXTURE,
        },
        {
          path: `${root}/src/packs/monsters/Goblins_iEPVvWezLlidfEbg/npc_Goblin_Warrior_6SR8siFeC5lWUzoO.json`,
          json: GOBLIN_MONSTER_FIXTURE,
        },
        // A Folder_*.json in the monsters pack and an actor from another pack must both be filtered out.
        { path: `${root}/src/packs/monsters/Folder_Goblins_iEPVvWezLlidfEbg.json`, json: { name: 'Goblins folder' } },
        { path: `${root}/src/packs/abilities/npc_not_a_monster.json`, json: { name: 'Ability' } },
      ]),
    );

    const docs = await githubTarballFetchPort(fetchServing(gz)).fetchMonsters({});
    expect(docs).toHaveLength(2);
    expect(docs).toContainEqual(AJAX_MONSTER_FIXTURE);
    expect(docs).toContainEqual(GOBLIN_MONSTER_FIXTURE);
  });

  it('throws on a non-2xx response, so the reconcile lands the run as failed', async () => {
    const gz = gzipSync(tarball([]));
    await expect(githubTarballFetchPort(fetchServing(gz, false, 404)).fetchMonsters({})).rejects.toThrow('404');
  });
});
