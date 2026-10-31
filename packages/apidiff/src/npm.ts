// Fetches published npm tarballs into a local cache and unpacks them.
import { createWriteStream } from 'node:fs';
import { access, mkdir, readFile, rename } from 'node:fs/promises';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { extract } from 'tar';

const REGISTRY = 'https://registry.npmjs.org';
export const CACHE = join(import.meta.dirname, '..', '..', '..', '.cache', 'npm');

export interface Packument {
  versions: Record<string, { dist: { tarball: string }; deprecated?: string }>;
  time: Record<string, string>;
}

export async function packument(pkg: string): Promise<Packument> {
  const res = await fetch(`${REGISTRY}/${pkg.replace('/', '%2F')}`);
  if (!res.ok) throw new Error(`packument ${pkg}: HTTP ${res.status}`);
  return (await res.json()) as Packument;
}

const exists = (p: string) => access(p).then(() => true, () => false);

/** Returns the directory holding the unpacked package (its package.json root). */
export async function unpack(pkg: string, version: string, tarball: string): Promise<string> {
  const dir = join(CACHE, `${pkg.replace('/', '__')}@${version}`);
  if (await exists(join(dir, 'package.json'))) return dir;
  await mkdir(dir, { recursive: true });

  const tgz = `${dir}.tgz`;
  if (!(await exists(tgz))) {
    const res = await fetch(tarball);
    if (!res.ok || !res.body) throw new Error(`tarball ${pkg}@${version}: HTTP ${res.status}`);
    await pipeline(Readable.fromWeb(res.body as never), createWriteStream(`${tgz}.part`));
    await rename(`${tgz}.part`, tgz);
  }
  // npm tarballs wrap everything in a single top-level folder (usually "package/").
  await extract({ file: tgz, cwd: dir, strip: 1 });
  return dir;
}

export async function readJson<T>(path: string): Promise<T> {
  return JSON.parse(await readFile(path, 'utf8')) as T;
}
