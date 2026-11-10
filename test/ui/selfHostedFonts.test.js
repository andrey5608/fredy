/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '../..');
const read = (...parts) => fs.readFileSync(path.join(root, ...parts), 'utf8');

/**
 * The interface used to load Schibsted Grotesk and JetBrains Mono from fonts.googleapis.com with a
 * stylesheet `<link>` in `index.html`. That is render-blocking and cross-origin, so a proxy, a VPN
 * or a network that cannot reach Google left the page hanging on a blank screen. The faces are now
 * bundled by Vite; these tests keep them from drifting back out.
 */
describe('self-hosted fonts', () => {
  it('does not ask any font CDN for a stylesheet or a connection', () => {
    const html = read('index.html');
    expect(html).not.toMatch(/fonts\.googleapis\.com/);
    expect(html).not.toMatch(/fonts\.gstatic\.com/);
  });

  it('bundles every weight of both faces the stylesheets use, from the entry point', () => {
    const entry = read('ui', 'src', 'Index.jsx');
    for (const weight of [400, 500, 600]) {
      expect(entry).toContain(`'@fontsource/schibsted-grotesk/latin-${weight}.css'`);
    }
    for (const weight of [400, 500]) {
      expect(entry).toContain(`'@fontsource/jetbrains-mono/latin-${weight}.css'`);
    }
  });

  it('only styles text in weights that are bundled, so none is synthesised by the browser', () => {
    const tokens = read('ui', 'src', 'tokens.less');
    const medium = Number(tokens.match(/@weight-medium:\s*(\d+)/)?.[1]);
    const strong = Number(tokens.match(/@weight-strong:\s*(\d+)/)?.[1]);
    expect([medium, strong]).toEqual([500, 600]);

    const bundled = new Set([400, medium, strong]);
    const used = new Set();
    const walk = (dir) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(full);
        else if (entry.name.endsWith('.less')) {
          for (const m of fs.readFileSync(full, 'utf8').matchAll(/font-weight:\s*(\d+)\s*[;!]/g)) {
            used.add(Number(m[1]));
          }
        }
      }
    };
    walk(path.join(root, 'ui', 'src'));

    expect([...used].filter((weight) => !bundled.has(weight))).toEqual([]);
  });

  it('declares the font packages the entry point imports', () => {
    const pkg = JSON.parse(read('package.json'));
    const declared = { ...pkg.dependencies, ...pkg.devDependencies };
    expect(declared).toHaveProperty('@fontsource/schibsted-grotesk');
    expect(declared).toHaveProperty('@fontsource/jetbrains-mono');
  });
});
