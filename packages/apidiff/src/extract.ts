// Extracts the public API surface of a .d.ts package with the TypeScript
// compiler API: every exported symbol plus the members of exported classes and
// interfaces, each with a normalised signature and its @deprecated note.
import ts from 'typescript';
import type { PackageFiles } from './npm.ts';
import LIBS from './ts-libs.json' with { type: 'json' };

export interface ApiSymbol {
  symbol: string;
  kind: string;
  signature: string;
  deprecated: string | null;
}

const MAX_SIG = 600;

const PKG = '/pkg/';
const LIB = '/lib/';
const libs = LIBS as Record<string, string>;

/** Everything in memory: package files under /pkg/, TypeScript's default libs under /lib/. */
function memoryHost(files: PackageFiles, options: ts.CompilerOptions): ts.CompilerHost {
  const dirs = new Set(['/pkg', '/lib']);
  for (const f of files.keys()) for (let i = f.indexOf('/'); i > 0; i = f.indexOf('/', i + 1)) dirs.add(PKG + f.slice(0, i));
  const read = (path: string) =>
    path.startsWith(PKG) ? files.get(path.slice(PKG.length)) : path.startsWith(LIB) ? libs[path.slice(LIB.length)] : undefined;
  return {
    getSourceFile: (path, lang) => {
      const text = read(path);
      return text === undefined ? undefined : ts.createSourceFile(path, text, lang);
    },
    getDefaultLibFileName: (o) => LIB + ts.getDefaultLibFileName(o),
    getDefaultLibLocation: () => LIB.slice(0, -1),
    writeFile: () => {},
    getCurrentDirectory: () => PKG.slice(0, -1),
    getCanonicalFileName: (f) => f,
    useCaseSensitiveFileNames: () => true,
    getNewLine: () => '\n',
    fileExists: (path) => read(path) !== undefined,
    readFile: read,
    directoryExists: (dir) => dirs.has(dir.replace(/\/$/, '')),
    getDirectories: () => [],
    realpath: (p) => p,
  };
}

export function extractApi(files: PackageFiles, entries: string[]): ApiSymbol[] {
  const roots = entries.filter((e) => files.has(e)).map((e) => PKG + e);
  if (roots.length === 0) throw new Error('no entry points found in package');

  const options: ts.CompilerOptions = {
    noEmit: true,
    skipLibCheck: true,
    types: [],
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
  };
  const program = ts.createProgram(roots, options, memoryHost(files, options));
  const checker = program.getTypeChecker();
  const out = new Map<string, ApiSymbol>();

  const add = (s: ApiSymbol) => {
    if (!out.has(s.symbol)) out.set(s.symbol, s);
  };

  // Earlier entries win, so core symbols keep their unprefixed names and the
  // webgpu/tsl entry points only contribute what the core entry lacks.
  for (const root of roots) {
    const source = program.getSourceFile(root);
    const moduleSymbol = source && checker.getSymbolAtLocation(source);
    if (!moduleSymbol) continue;

    for (const exported of checker.getExportsOfModule(moduleSymbol)) {
      const sym = exported.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(exported) : exported;
      const name = exported.getName();
      if (name === 'default') continue;
      const decl = sym.declarations?.[0];
      if (!decl) continue;

      add({ symbol: name, kind: kindOf(sym), signature: signatureOf(checker, sym, decl), deprecated: deprecatedOf(sym, checker) });

      if (sym.flags & (ts.SymbolFlags.Class | ts.SymbolFlags.Interface)) {
        for (const member of memberSymbols(checker, sym)) {
          const mdecl = member.declarations?.[0];
          if (!mdecl || isPrivate(mdecl)) continue;
          const isStatic = ts.getCombinedModifierFlags(mdecl as ts.Declaration) & ts.ModifierFlags.Static;
          const key = `${name}.${member.getName()}`;
          add({
            symbol: out.has(key) ? `${key} (static)` : key,
            kind: (isStatic ? 'static ' : '') + kindOf(member),
            signature: signatureOf(checker, member, mdecl),
            deprecated: deprecatedOf(member, checker),
          });
        }
      }
    }
  }
  return [...out.values()].sort((a, b) => a.symbol.localeCompare(b.symbol));
}

/**
 * Own members, plus members of interfaces merged into the symbol by name
 * (e.g. `interface Material extends MaterialProperties {}` next to
 * `class Material`). Members inherited through `extends` belong to the parent
 * and are reported there.
 */
function memberSymbols(checker: ts.TypeChecker, sym: ts.Symbol): ts.Symbol[] {
  const members = new Map<string, ts.Symbol>();
  const isMember = (m: ts.Symbol) => !!(m.flags & (ts.SymbolFlags.Property | ts.SymbolFlags.Method | ts.SymbolFlags.Accessor));
  sym.members?.forEach((m) => { if (isMember(m)) members.set(m.getName(), m); });

  if (sym.flags & ts.SymbolFlags.Class) {
    for (const decl of sym.declarations ?? []) {
      if (!ts.isInterfaceDeclaration(decl)) continue;
      for (const clause of decl.heritageClauses ?? []) {
        for (const expr of clause.types) {
          for (const m of checker.getPropertiesOfType(checker.getTypeAtLocation(expr))) {
            if (!members.has(m.getName())) members.set(m.getName(), m);
          }
        }
      }
    }
    sym.exports?.forEach((m) => { if (isMember(m)) members.set(`static ${m.getName()}`, m); });
  }
  return [...members.values()];
}

function isPrivate(decl: ts.Node): boolean {
  const flags = ts.getCombinedModifierFlags(decl as ts.Declaration);
  if (flags & (ts.ModifierFlags.Private | ts.ModifierFlags.Protected)) return true;
  const name = (decl as ts.NamedDeclaration).name;
  return !!name && ts.isPrivateIdentifier(name);
}

function kindOf(sym: ts.Symbol): string {
  const f = sym.flags;
  if (f & ts.SymbolFlags.Class) return 'class';
  if (f & ts.SymbolFlags.Interface) return 'interface';
  if (f & ts.SymbolFlags.Enum) return 'enum';
  if (f & ts.SymbolFlags.Function) return 'function';
  if (f & ts.SymbolFlags.Method) return 'method';
  if (f & ts.SymbolFlags.Accessor) return 'accessor';
  if (f & ts.SymbolFlags.Property) return 'property';
  if (f & ts.SymbolFlags.TypeAlias) return 'type';
  if (f & ts.SymbolFlags.Variable) return 'const';
  return 'other';
}

function signatureOf(checker: ts.TypeChecker, sym: ts.Symbol, decl: ts.Declaration): string {
  const f = sym.flags;
  let sig: string;
  if (f & ts.SymbolFlags.Class) {
    const heritage = ts.isClassDeclaration(decl) ? decl.heritageClauses?.map((h) => h.getText()).join(' ') : '';
    sig = `class ${sym.getName()}${heritage ? ' ' + heritage : ''}`;
  } else if (f & ts.SymbolFlags.Interface) {
    sig = `interface ${sym.getName()}`;
  } else if (f & ts.SymbolFlags.TypeAlias) {
    sig = `type ${sym.getName()} = ${checker.typeToString(checker.getDeclaredTypeOfSymbol(sym), undefined, ts.TypeFormatFlags.NoTruncation)}`;
  } else if (f & (ts.SymbolFlags.Function | ts.SymbolFlags.Method)) {
    const type = checker.getTypeOfSymbolAtLocation(sym, decl);
    sig = type.getCallSignatures().map((s) => checker.signatureToString(s)).join(' | ') || checker.typeToString(type);
  } else {
    sig = checker.typeToString(checker.getTypeOfSymbolAtLocation(sym, decl), undefined, ts.TypeFormatFlags.NoTruncation);
  }
  // Module paths print as `typeof import("/pkg/src/…")`; keep them package-relative.
  sig = sig.replace(/\s+/g, ' ').replaceAll('"/pkg/', '"').trim();
  return sig.length > MAX_SIG ? sig.slice(0, MAX_SIG) + '…' : sig;
}

function deprecatedOf(sym: ts.Symbol, checker: ts.TypeChecker): string | null {
  const tag = sym.getJsDocTags(checker).find((t) => t.name === 'deprecated');
  if (!tag) return null;
  const text = ts.displayPartsToString(tag.text).replace(/\s+/g, ' ').trim();
  return text || 'deprecated';
}
