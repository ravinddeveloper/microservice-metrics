import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');
const distTypesDir = path.resolve(rootDir, 'dist', 'types');
const distCjsDir = path.resolve(rootDir, 'dist', 'cjs');

// Copy types to dist/types/
fs.mkdirSync(distTypesDir, { recursive: true });
const srcDts = path.resolve(rootDir, 'index.d.ts');
const targetDts = path.resolve(distTypesDir, 'index.d.ts');
if (fs.existsSync(srcDts)) {
    fs.copyFileSync(srcDts, targetDts);
    console.log(`[copy-types] Copied ${srcDts} -> ${targetDts}`);
} else {
    console.warn(`[copy-types] Warning: Source ${srcDts} does not exist`);
}

// Write a package.json into dist/cjs/ to declare CommonJS module type
// This allows Node.js to treat .js files in that directory as CJS even though
// the root package.json declares "type":"module"
if (fs.existsSync(distCjsDir)) {
    const cjsPkg = path.resolve(distCjsDir, 'package.json');
    fs.writeFileSync(cjsPkg, JSON.stringify({ type: 'commonjs' }, null, 2) + '\n');
    console.log(`[copy-types] Wrote ${cjsPkg}`);
}

