import { rmSync } from 'node:fs';

import { build } from 'esbuild';

rmSync('./dist', { force: true, recursive: true });

await build({
  bundle: true,
  entryPoints: ['./src/index.ts'],
  format: 'esm',
  outbase: './src',
  outdir: './dist',
  outExtension: { '.js': '.mjs' },
  packages: 'external',
  platform: 'browser',
  target: 'es2022',
});

// Prepend a CSS side-effect import so bundlers (Next.js webpack/turbopack)
// include the component styles when consuming the pre-built dist output.
// In dev, Next.js resolves the `development` export to `./src/index.ts` and
// processes `.module.css` imports natively, so this import is never reached.
// In prod, Next.js resolves to `./dist/index.mjs` and needs this import to
// load the CSS Module output from `./dist/index.css`.
const { readFileSync, writeFileSync, existsSync } = await import('node:fs');
const mjsPath = './dist/index.mjs';
if (existsSync('./dist/index.css') && existsSync(mjsPath)) {
  const mjs = readFileSync(mjsPath, 'utf8');
  writeFileSync(mjsPath, `import "./index.css";\n${mjs}`);
}
