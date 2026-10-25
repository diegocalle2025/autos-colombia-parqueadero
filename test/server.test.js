const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { once } = require('node:events');
const { test } = require('node:test');
const net = require('node:net');

async function getFreePort() {
  const server = net.createServer();
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const { port } = server.address();
  await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  return port;
}

test('API persiste y aplica reglas de acceso', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'autos-colombia-test-'));
  const databasePath = path.join(directory, 'test.sqlite');
  const port = await getFreePort();
  const baseUrl = `http://127.0.0.1:${port}`;
  const child = spawn(process.execPath, ['src/server.js'], {
    cwd: path.join(__dirname, '..'),
    env: { ...process.env, PORT: String(port), DATABASE_PATH: databasePath },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  let output = '';
  child.stdout.setEncoding('utf8');
  child.stdout.on('data', chunk => { output += chunk; });
  child.stderr.setEncoding('utf8');
  child.stderr.on('data', chunk => { output += chunk; });

  try {
    const started = new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error(`Server did not start: ${output}`)), 10000);
      child.stdout.on('data', chunk => {
        if (chunk.includes('Servidor de Autos Colombia')) {
          clearTimeout(timeout);
          resolve();
        }
      });
      child.once('error', reject);
      child.once('exit', code => reject(new Error(`Server exited ${code}: ${output}`)));
    });
    await started;

    const validation = await fetch(`${baseUrl}/api/validar-placa`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ placa: 'XYZ789' })
    });
    assert.equal(validation.status, 200);
    assert.equal((await validation.json()).valido, true);
    const members = await fetch(`${baseUrl}/api/mensualistas`);
    assert.equal(members.status, 200);
    assert.equal((await members.json()).find(member => member.placa === 'MTO45D').estadoMensualidad, 'Vencida');

    const entryResponse = await fetch(`${baseUrl}/api/entrada`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ placa: 'XYZ789', id_celda: 5, operador: 'Operador QA', registrar_novedad: true, novedad: 'Rayon en puerta', tipo_novedad: 'Carroceria' })
    });
    assert.equal(entryResponse.status, 201);
    const entry = await entryResponse.json();
    assert.equal(entry.ticket.placa, 'XYZ789');
    assert.equal(entry.ticket.novedades[0].descripcion, 'Rayon en puerta');
    const ticketResponse = await fetch(`${baseUrl}/api/tickets/${entry.ticket.folio}`);
    assert.equal(ticketResponse.status, 200);
    assert.equal((await ticketResponse.json()).novedades.length, 1);

    const duplicate = await fetch(`${baseUrl}/api/entrada`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ placa: 'XYZ789', id_celda: 6, operador: 'Operador QA' })
    });
    assert.equal(duplicate.status, 409);

    const incompatible = await fetch(`${baseUrl}/api/entrada`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ placa: 'KLR890', id_celda: 5, operador: 'Operador QA' })
    });
    assert.equal(incompatible.status, 409);

    const missingDescription = await fetch(`${baseUrl}/api/entrada`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ placa: 'KLR890', id_celda: 1, operador: 'Operador QA', registrar_novedad: true, novedad: '' })
    });
    assert.equal(missingDescription.status, 400);

    const exitResponse = await fetch(`${baseUrl}/api/salida`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id_acceso: entry.ticket.folio, operador: 'Operador QA', novedad_salida: 'Entrega conforme' })
    });
    assert.equal(exitResponse.status, 200);
    assert.equal((await exitResponse.json()).celdaLiberada, 'B-01');

    const today = new Date().toLocaleDateString('en-CA');
    const historyResponse = await fetch(`${baseUrl}/api/historico?placa=XYZ&desde=${today}&hasta=${today}`);
    assert.equal(historyResponse.status, 200);
    const history = await historyResponse.json();
    assert.equal(history.length, 1);
    assert.equal(history[0].estado, 'Finalizado');
    assert.equal(history[0].novedades.length, 2);

    const invalidDateRange = await fetch(`${baseUrl}/api/historico?desde=2026-02-30`);
    assert.equal(invalidDateRange.status, 400);
  } finally {
    child.kill('SIGTERM');
    await once(child, 'exit');
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
