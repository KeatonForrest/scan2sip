// Regenerates docs/DEPENDENCIES.md from the exact committed lockfile
// plus the installed packages' own license metadata. Run after
// `npm ci`. Deterministic: sorted by package name and version.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url)) + '/..';
const lock = JSON.parse(fs.readFileSync(path.join(root, 'package-lock.json'), 'utf8'));

function licenseOf(name) {
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(root, 'node_modules', name, 'package.json'), 'utf8'));
    const lic = pkg.license;
    if (typeof lic === 'string') return lic;
    if (lic && typeof lic === 'object' && lic.type) return lic.type;
    if (Array.isArray(pkg.licenses)) return pkg.licenses.map((l) => l.type ?? 'unknown').join(' OR ');
    return 'not declared in package metadata';
  } catch {
    return 'not installed (run npm ci)';
  }
}

const rows = [];
for (const [key, entry] of Object.entries(lock.packages ?? {})) {
  if (!key.startsWith('node_modules/') || !entry.version) continue;
  const name = key.slice('node_modules/'.length);
  if (name.includes('node_modules/')) continue; // top-level entries only
  rows.push({ name, version: entry.version, license: entry.license ?? licenseOf(name), dev: entry.dev === true });
}
rows.sort((a, b) => a.name.localeCompare(b.name));

const lines = [
  '# Dependency and license inventory',
  '',
  `Generated from \`package-lock.json\` (lockfileVersion ${lock.lockfileVersion}) by`,
  '`scripts/dependency-inventory.mjs`. Direct dependency: `express` (runtime);',
  'everything else is its transitive tree or dev tooling recorded in the lock.',
  '',
  '| Package | Version | License (per package metadata) | Kind |',
  '|---|---|---|---|',
  ...rows.map((r) => `| ${r.name} | ${r.version} | ${r.license} | ${r.dev ? 'dev' : 'runtime'} |`),
  '',
  '## License notice handling',
  '',
  '- This project itself has **no `LICENSE` file yet**; its license is',
  '  decided only at the final rights review before any public release.',
  '  Nothing in this inventory grants rights in this project\'s own code.',
  '- Third-party packages remain under their own licenses as listed',
  '  above. Any distributed release must retain the packages\' copyright',
  '  and license notices (for MIT/ISC/BSD-style licenses, include the',
  '  notice text from each package; Apache-2.0 packages require the',
  '  license text and NOTICE handling if present).',
  '- The inventory is regenerated from the exact lock; if the lock',
  '  changes, regenerate and re-review before release.',
  '',
].join('\n');

fs.writeFileSync(path.join(root, 'docs/DEPENDENCIES.md'), lines);
console.log(`wrote docs/DEPENDENCIES.md with ${rows.length} packages`);
