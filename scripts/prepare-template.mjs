import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const homeHtml = await fs.readFile(path.join(root, 'templates/home.html'), 'utf8');
await fs.writeFile(
  path.join(root, 'src/generated.ts'),
  'export const homeHtml = ' + JSON.stringify(homeHtml) + ';\n'
);
console.log('Server HTML template prepared');
