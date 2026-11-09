import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, it } from 'vitest';

const root = fileURLToPath(new URL('../../', import.meta.url));

it('ships ordinary templates without a design-system catalog or inherited context', async () => {
  const official = path.join(root, 'plugins/_official');
  expect(await readdir(official)).not.toContain('design-systems');
  for (const tier of await readdir(official, { withFileTypes: true })) {
    if (!tier.isDirectory()) continue;
    for (const plugin of await readdir(path.join(official, tier.name), { withFileTypes: true })) {
      if (!plugin.isDirectory()) continue;
      const dir = path.join(official, tier.name, plugin.name);
      const manifest = JSON.parse(await readFile(path.join(dir, 'open-design.json'), 'utf8'));
      expect(manifest.od?.context?.designSystem, `${tier.name}/${plugin.name}`).toBeUndefined();
    }
  }
  const dashboard = path.join(official, 'examples/dashboard');
  expect(await readFile(path.join(dashboard, 'example.html'), 'utf8')).toContain('<html');
  expect(await readFile(path.join(dashboard, 'SKILL.md'), 'utf8')).not.toMatch(/design_system:|active DESIGN\.md/);
});
