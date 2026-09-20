import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import path from 'node:path';

const root = fileURLToPath(new URL('../', import.meta.url));
const config = JSON.parse(await readFile(path.join(root, 'wrangler.jsonc'), 'utf8'));
delete config.account_id;
delete config.routes;
config.name = 'operation-valor-local';
config.main = path.join(root, config.main);
config.assets.directory = path.join(root, config.assets.directory);
config.vars = { APP_ORIGIN: 'http://127.0.0.1:8787', LOCAL_PREVIEW: 'true' };
const directory = path.join(root, '.wrangler');
await mkdir(directory, { recursive: true });
const configPath = path.join(directory, 'local.json');
await writeFile(configPath, JSON.stringify(config, null, 2));
const child = spawn(process.execPath, [path.join(root, 'node_modules/wrangler/bin/wrangler.js'), 'dev', '--local', '--config', configPath, '--ip', '127.0.0.1', '--port', '8787'], {
  cwd: root,
  stdio: 'inherit',
  env: { ...process.env, WRANGLER_SEND_METRICS: 'false', WRANGLER_LOG_PATH: path.join(directory, 'dev.log') },
});
child.on('exit', code => { process.exitCode = code ?? 1; });
