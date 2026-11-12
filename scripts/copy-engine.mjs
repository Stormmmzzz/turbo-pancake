import { copyFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

const source = resolve('node_modules/stockfish/bin');
const target = resolve('public/engine');
const files = ['stockfish-19-lite-single.js', 'stockfish-19-lite-single.wasm'];

await mkdir(target, { recursive: true });
for (const file of files) {
  const from = resolve(source, file);
  if (!existsSync(from)) {
    console.warn(`Stockfish asset not found yet: ${from}`);
    continue;
  }
  await copyFile(from, resolve(target, file));
  console.log(`Copied ${file} to public/engine/`);
}
