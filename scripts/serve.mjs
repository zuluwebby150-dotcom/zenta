// Tiny static server for local checks: node scripts/serve.mjs [port]
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png' };
const port = +process.argv[2] || 5173;
createServer(async (req, res) => {
  const p = normalize(decodeURIComponent(req.url.split('?')[0])).replace(/^[\\/]+/, '') || 'index.html';
  if (p.startsWith('..')) { res.writeHead(403); return res.end('forbidden'); }
  try { const b = await readFile(join(process.cwd(), p)); res.writeHead(200, { 'content-type': types[extname(p)] || 'application/octet-stream' }); res.end(b); }
  catch { res.writeHead(404); res.end('not found'); }
}).listen(port, '127.0.0.1', () => console.log('serving on http://127.0.0.1:' + port));
