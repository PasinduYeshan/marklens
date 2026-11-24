// Static server for the browser harness: `npm run dev`, then open http://localhost:5178/
import { createServer } from 'node:http';
import { readFile, stat, writeFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const port = Number(process.env.PORT ?? 5178);
const types = {
  '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css',
  '.md': 'text/markdown; charset=utf-8', '.json': 'application/json', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.gif': 'image/gif', '.woff2': 'font/woff2', '.ttf': 'font/ttf', '.map': 'application/json',
};

createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', `http://localhost:${port}`);
  // Dev-only: save a rendered asset (e.g. the PNG icon) into media/.
  if (req.method === 'PUT' && url.pathname === '/__save') {
    const name = url.searchParams.get('name') ?? '';
    if (!/^[\w.-]+\.png$/.test(name)) return void res.writeHead(400).end('bad name');
    const chunks = [];
    for await (const c of req) chunks.push(c);
    await writeFile(join(root, 'media', name), Buffer.concat(chunks));
    return void res.writeHead(204).end();
  }
  let path = decodeURIComponent(url.pathname);
  if (path === '/') path = '/dev/harness.html';
  const file = normalize(join(root, path));
  if (!file.startsWith(root)) return void res.writeHead(403).end();
  try {
    const s = await stat(file);
    if (!s.isFile()) throw new Error('not a file');
    res.writeHead(200, { 'Content-Type': types[extname(file)] ?? 'application/octet-stream', 'Cache-Control': 'no-store' });
    res.end(await readFile(file));
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain' }).end('Not found');
  }
}).listen(port, () => console.log(`MarkLens harness on http://localhost:${port}/`));
