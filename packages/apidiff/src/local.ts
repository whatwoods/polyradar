// In-process extraction, for the CLI and the container server.
import { extractApi } from './extract.ts';
import { unpack } from './npm.ts';
import type { Extractor } from './run.ts';

export const localExtractor: Extractor = async ({ typesPackage, version, tarball, entries }) =>
  extractApi(await unpack(typesPackage, version, tarball), entries);
