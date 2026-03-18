import { spawn } from 'node:child_process';

const port = 3101;
const baseUrl = `http://127.0.0.1:${port}`;
const instance = `smoke-${Date.now()}`;
const apiKey = 'smoke-test-key';

const server = spawn('node', ['dist/index.js'], {
  env: {
    ...process.env,
    PORT: String(port),
    GLOBAL_API_KEY: apiKey,
    LOG_LEVEL: 'error',
  },
  stdio: ['ignore', 'pipe', 'pipe'],
});

server.stdout.on('data', (chunk) => process.stdout.write(chunk));
server.stderr.on('data', (chunk) => process.stderr.write(chunk));

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const request = async (pathname, options = {}) => {
  const response = await fetch(`${baseUrl}${pathname}`, {
    ...options,
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${apiKey}`,
      ...(options.headers || {}),
    },
  });

  const json = await response.json();
  return { statusCode: response.status, json };
};

const ensureShape = (name, payload) => {
  if (typeof payload.success !== 'boolean') throw new Error(`${name}: success missing`);
  if (!['CONNECTED', 'DISCONNECTED', 'QRCODE', 'ERROR'].includes(payload.status)) {
    throw new Error(`${name}: invalid status ${payload.status}`);
  }
  if (typeof payload.instance !== 'string') throw new Error(`${name}: instance missing`);
  if (!(typeof payload.qrcode === 'string' || payload.qrcode === null)) {
    throw new Error(`${name}: qrcode invalid`);
  }
};

try {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    try {
      const response = await fetch(`${baseUrl}/health`);
      if (response.ok) break;
    } catch {}
    await sleep(500);
    if (attempt === 29) throw new Error('Server did not become healthy in time');
  }

  const create = await request('/instance/create', {
    method: 'POST',
    body: JSON.stringify({ instance }),
  });
  ensureShape('create', create.json);

  const connect = await request('/instance/connect', {
    method: 'POST',
    body: JSON.stringify({ instance }),
  });
  ensureShape('connect', connect.json);

  const status = await request(`/instance/status/${instance}`);
  ensureShape('status', status.json);

  console.log(JSON.stringify({
    create: create.json,
    connect: connect.json,
    status: status.json,
  }, null, 2));
} finally {
  server.kill('SIGINT');
  await sleep(1000);
}
