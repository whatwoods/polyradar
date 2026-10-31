// Packages whose public API we snapshot. `name` is what users and agents ask
// about; `typesPackage` is where the .d.ts files come from.
export interface TrackedPackage {
  name: string;
  typesPackage: string;
  entries: string[];
  /** Earliest minor version to backfill. */
  fromMinor: number;
  label: (version: string) => string;
}

export const PACKAGES: Record<string, TrackedPackage> = {
  three: {
    name: 'three',
    typesPackage: '@types/three',
    entries: ['index.d.ts', 'build/three.webgpu.d.ts', 'build/three.tsl.d.ts'],
    fromMinor: 125,
    label: (v) => `r${v.split('.')[1]}`,
  },
};

/** Accepts "r162", "162", "0.162", "0.162.0". Returns the minor number for three-style versions. */
export function parseThreeRevision(input: string): number | null {
  const m = /^(?:r|0\.)?(\d{2,3})(?:\.\d+)?$/i.exec(input.trim());
  return m ? Number(m[1]) : null;
}
