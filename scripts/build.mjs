import './prepare-template.mjs';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {build} from 'esbuild';

const root = fileURLToPath(new URL('../', import.meta.url));
await fs.mkdir(path.join(root, 'backend'), {recursive:true});
await build({
  absWorkingDir:root,
  entryPoints:{
    index:'src/node.ts',
    migrate:'scripts/migrate.ts',
    seed:'scripts/seed.ts',
    'editorial-worker':'src/editorial-worker.ts',
    'source-parser':'src/source-parser.ts'
  },
  outdir:'backend',
  bundle:true,
  format:'esm',
  platform:'node',
  target:'node24',
  packages:'external'
});
console.log('Node PostgreSQL backend built');
