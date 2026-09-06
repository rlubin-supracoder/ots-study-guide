import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve, extname } from 'node:path';
import { siteFiles } from './site-files.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const port = Number(process.env.PORT || 8000);
const types = { '.html': 'text/html', '.js': 'text/javascript', '.md': 'text/markdown' };
const server = createServer(async (req, res) => {
  try {
    const path = new URL(req.url, 'http://localhost').pathname;
    // Support both the root and the GitHub project subdirectory for local checks.
    const relative = path.replace(/^\/ots-study-guide(?=\/|$)/, '').replace(/^\//, '');
    const name = relative === '' ? 'index.html' : relative;
    if (!siteFiles.includes(name) || name === '.nojekyll') {
      res.writeHead(404); res.end('Not found'); return;
    }
    const content = await readFile(resolve(root, name));
    res.writeHead(200, { 'Content-Type': `${types[extname(name)] || 'text/plain'}; charset=utf-8` });
    res.end(content);
  } catch {
    res.writeHead(500); res.end('Unable to load site file');
  }
});
server.listen(port, '127.0.0.1', () => console.log(`Local: http://127.0.0.1:${port}/`));
