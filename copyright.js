/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

import fs from 'fs/promises';
import path from 'path';

async function getAllFiles(dir = '.') {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  let files = [];
  for (let entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
      files = files.concat(await getAllFiles(fullPath));
    } else if (fullPath.endsWith('.js') || fullPath.endsWith('.jsx')) {
      files.push(fullPath);
    }
  }
  return files;
}

async function addCopyright() {
  return;
}

const filesToProcess = process.argv.length > 2 ? process.argv.slice(2) : await getAllFiles();
await addCopyright(filesToProcess);
