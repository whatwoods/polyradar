// Bundles the TypeScript default lib files (what target ES2022 pulls in) into
// src/ts-libs.json, so extraction needs no file system. Runs on install.
import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';

const dir = dirname(createRequire(import.meta.url).resolve('typescript/lib/typescript.js'));
const libs = {};
const visit = (file) => {
  if (libs[file]) return;
  const text = readFileSync(join(dir, file), 'utf8');
  libs[file] = text;
  for (const [, lib] of text.matchAll(/^\/\/\/\s*<reference lib="([^"]+)"/gm)) visit(`lib.${lib.toLowerCase()}.d.ts`);
};
visit('lib.es2022.full.d.ts');
writeFileSync(join(import.meta.dirname, '..', 'src', 'ts-libs.json'), JSON.stringify(libs));
console.log(`ts-libs: ${Object.keys(libs).length} files, ${Math.round(JSON.stringify(libs).length / 1024)} KB`);
