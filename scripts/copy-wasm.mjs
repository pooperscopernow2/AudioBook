import { createRequire } from 'node:module';
import { readdir, mkdir, copyFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const source = dirname(require.resolve('onnxruntime-web'));
const destination = fileURLToPath(new URL('../public/wasm/', import.meta.url));
await mkdir(destination, { recursive: true });
const files = (await readdir(source)).filter(name => name.endsWith('.wasm'));
if (!files.length) throw new Error('ONNX runtime WASM files are missing. Run npm install first.');
for (const file of files) await copyFile(join(source, file), join(destination, file));
console.log(`Prepared ${files.length} ONNX runtime WASM files.`);
