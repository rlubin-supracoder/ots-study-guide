import {build} from 'esbuild';
import {spawnSync} from 'node:child_process';
await build({entryPoints:['src/parse-worker.mjs'],outfile:'public/parse-worker.js',bundle:true,format:'esm',minify:true,target:'es2022',legalComments:'eof'});
const result=spawnSync(process.execPath,['node_modules/wrangler/bin/wrangler.js','deploy','--dry-run','--outdir','dist'],{stdio:'inherit',env:{...process.env,WRANGLER_SEND_METRICS:'false'}});process.exit(result.status??1);
