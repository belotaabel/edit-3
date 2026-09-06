import { createServer } from 'node:http';
import { extname, join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFile, stat } from 'node:fs/promises';

const root = resolve(fileURLToPath(new URL('./dist/public', import.meta.url)));
const port = Number(process.env.PORT ?? '4173');

if (!Number.isInteger(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${process.env.PORT ?? ''}"`);
}

const contentTypes = {
  '.css': 'text/css; charset=utf-8',
  '.gif': 'image/gif',
  '.html': 'text/html; charset=utf-8',
  '.ico': 'image/x-icon',
  '.jpg': 'image/jpeg',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
};

function send(response, statusCode, body, contentType) {
  response.writeHead(statusCode, { 'content-type': contentType });
  response.end(body);
}

async function getFilePath(requestUrl) {
  let requestPath;
  try {
    requestPath = decodeURIComponent(new URL(requestUrl, 'http://localhost').pathname);
  } catch {
    return undefined;
  }

  const filePath = resolve(root, `.${normalize(requestPath)}`);
  if (filePath !== root && !filePath.startsWith(`${root}/`)) return undefined;

  try {
    if ((await stat(filePath)).isFile()) return filePath;
  } catch {
    // Fall through to the SPA entry point for client-side routes.
  }

  return extname(requestPath) ? undefined : join(root, 'index.html');
}

const server = createServer(async (request, response) => {
  if ((request.method === 'GET' || request.method === 'HEAD') && request.url?.split('?')[0] === '/healthz') {
    response.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' });
    response.end(request.method === 'GET' ? 'ok' : undefined);
    return;
  }

  if (request.method !== 'GET' && request.method !== 'HEAD') {
    send(response, 405, 'Method Not Allowed', 'text/plain; charset=utf-8');
    return;
  }

  const filePath = request.url ? await getFilePath(request.url) : undefined;
  if (!filePath) {
    send(response, 404, 'Not Found', 'text/plain; charset=utf-8');
    return;
  }

  try {
    const body = await readFile(filePath);
    response.writeHead(200, {
      'content-type': contentTypes[extname(filePath)] ?? 'application/octet-stream',
      'content-length': body.byteLength,
    });
    if (request.method === 'GET') response.end(body);
    else response.end();
  } catch {
    send(response, 500, 'Internal Server Error', 'text/plain; charset=utf-8');
  }
});

server.listen(port, '0.0.0.0', () => {
  console.log(`Mini App server listening on port ${port}`);
});
