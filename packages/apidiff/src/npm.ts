// Fetches published npm tarballs and unpacks their type declarations in
// memory, so the same code runs in Node and in a Worker (no file system).
const REGISTRY = 'https://registry.npmjs.org';

export interface Packument {
  versions: Record<string, { dist: { tarball: string }; deprecated?: string }>;
  time: Record<string, string>;
}

export async function packument(pkg: string): Promise<Packument> {
  const res = await fetch(`${REGISTRY}/${pkg.replace('/', '%2F')}`);
  if (!res.ok) throw new Error(`packument ${pkg}: HTTP ${res.status}`);
  return (await res.json()) as Packument;
}

/** Package files keyed by path relative to the package root. Only declarations and package.json are kept. */
export type PackageFiles = Map<string, string>;

const KEEP = /(\.d\.[cm]?ts|^package\.json)$/;

export async function unpack(pkg: string, version: string, tarball: string): Promise<PackageFiles> {
  const res = await fetch(tarball);
  if (!res.ok || !res.body) throw new Error(`tarball ${pkg}@${version}: HTTP ${res.status}`);
  const tar = new Uint8Array(await new Response(res.body.pipeThrough(new DecompressionStream('gzip'))).arrayBuffer());
  return untar(tar, (path) => KEEP.test(path));
}

/** Minimal ustar reader: regular files, pax and GNU long names. Strips the top-level folder npm wraps everything in. */
export function untar(buf: Uint8Array, keep: (path: string) => boolean): PackageFiles {
  const files: PackageFiles = new Map();
  const text = new TextDecoder();
  const str = (a: number, b: number) => text.decode(buf.subarray(a, b)).replace(/\0.*$/s, '');
  let longName: string | null = null;
  for (let off = 0; off + 512 <= buf.length;) {
    if (buf[off] === 0) break; // end-of-archive blocks
    const size = parseInt(str(off + 124, off + 136).trim() || '0', 8);
    const type = String.fromCharCode(buf[off + 156]!);
    const prefix = str(off + 345, off + 500);
    let name = longName ?? (prefix ? `${prefix}/${str(off, off + 100)}` : str(off, off + 100));
    longName = null;
    const body = buf.subarray(off + 512, off + 512 + size);
    off += 512 + Math.ceil(size / 512) * 512;
    if (type === 'x') {
      longName = /(?:^|\n)\d+ path=([^\n]*)\n/.exec(text.decode(body))?.[1] ?? null;
    } else if (type === 'L') {
      longName = text.decode(body).replace(/\0.*$/s, '');
    } else if (type === '0' || type === '\0') {
      name = name.replace(/^[^/]*\//, '');
      if (keep(name)) files.set(name, text.decode(body));
    }
  }
  return files;
}
