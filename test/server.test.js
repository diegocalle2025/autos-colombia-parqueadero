const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { once } = require('node:events');
const { test } = require('node:test');
const net = require('node:net');
const { DatabaseSync } = require('node:sqlite');

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

    const newUser = {
      documento_identidad: '9000000001',
      nombres: 'Usuario',
      apellidos: 'De Prueba',
      telefono: '3000000001',
      correo_electronico: 'usuario.prueba@example.com'
    };
    const createUser = await fetch(`${baseUrl}/api/usuarios`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(newUser)
    });
    assert.equal(createUser.status, 201);
    const createdUser = (await createUser.json()).usuario;
    assert.equal(createdUser.documento, newUser.documento_identidad);
    assert.equal(createdUser.estado, 'Activo');
    assert.match(createdUser.fecha_registro, /^\d{4}-\d{2}-\d{2}T/);

    const users = await fetch(`${baseUrl}/api/usuarios`);
    assert.equal(users.status, 200);
    const userList = await users.json();
    assert.ok(userList.some(user => user.documento === newUser.documento_identidad
      && user.nombres === newUser.nombres
      && user.apellidos === newUser.apellidos
      && user.telefono === newUser.telefono
      && user.correo === newUser.correo_electronico
      && user.estado === 'Activo'));

    const duplicateUser = await fetch(`${baseUrl}/api/usuarios`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(newUser)
    });
    assert.equal(duplicateUser.status, 409);
    assert.equal((await duplicateUser.json()).campo, 'documento_identidad');

    for (const field of Object.keys(newUser)) {
      const invalidUser = { ...newUser, documento_identidad: `missing-${field}` };
      delete invalidUser[field];
      const response = await fetch(`${baseUrl}/api/usuarios`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(invalidUser)
      });
      assert.equal(response.status, 400, `Expected missing ${field} to be rejected`);
      assert.equal((await response.json()).campo, field);
    }

    const invalidEmail = await fetch(`${baseUrl}/api/usuarios`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...newUser, documento_identidad: '9000000002', correo_electronico: 'no-es-correo' })
    });
    assert.equal(invalidEmail.status, 400);
    const oversizedUserField = await fetch(`${baseUrl}/api/usuarios`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...newUser, documento_identidad: '9000000003', nombres: 'N'.repeat(101) })
    });
    assert.equal(oversizedUserField.status, 400);

    const cellTypes = ['Automóvil', 'Camioneta', 'Motocicleta'];
    for (const [index, tipo] of cellTypes.entries()) {
      const cell = {
        codigo_celda: `QA-${index + 1}`,
        tipo_permitido: tipo,
        ubicacion_sector: 'Sector de pruebas'
      };
      const createCell = await fetch(`${baseUrl}/api/celdas`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(cell)
      });
      assert.equal(createCell.status, 201);
      const createdCell = (await createCell.json()).celda;
      assert.equal(createdCell.codigo, cell.codigo_celda);
      assert.equal(createdCell.tipo, tipo);
      assert.equal(createdCell.estado, 'Disponible');
      assert.equal(createdCell.ubicacion, cell.ubicacion_sector);
    }

    const cells = await fetch(`${baseUrl}/api/celdas`);
    assert.equal(cells.status, 200);
    const cellList = await cells.json();
    assert.ok(cellTypes.every(tipo => cellList.some(cell => cell.tipo === tipo)));

    const duplicateCell = await fetch(`${baseUrl}/api/celdas`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        codigo_celda: 'QA-1',
        tipo_permitido: 'Automóvil',
        ubicacion_sector: 'Otra ubicación'
      })
    });
    assert.equal(duplicateCell.status, 409);
    assert.equal((await duplicateCell.json()).campo, 'codigo_celda');

    for (const field of ['codigo_celda', 'tipo_permitido', 'ubicacion_sector']) {
      const invalidCell = {
        codigo_celda: `missing-${field}`,
        tipo_permitido: 'Automóvil',
        ubicacion_sector: 'Sector de pruebas'
      };
      delete invalidCell[field];
      const response = await fetch(`${baseUrl}/api/celdas`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(invalidCell)
      });
      assert.equal(response.status, 400, `Expected missing ${field} to be rejected`);
      assert.equal((await response.json()).campo, field);
    }

    const invalidCellType = await fetch(`${baseUrl}/api/celdas`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        codigo_celda: 'QA-INVALID',
        tipo_permitido: 'Bicicleta',
        ubicacion_sector: 'Sector de pruebas'
      })
    });
    assert.equal(invalidCellType.status, 400);
    const oversizedCellField = await fetch(`${baseUrl}/api/celdas`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        codigo_celda: 'QA-LONG',
        tipo_permitido: 'Automóvil',
        ubicacion_sector: 'S'.repeat(101)
      })
    });
    assert.equal(oversizedCellField.status, 400);

    const integrityDatabase = new DatabaseSync(databasePath);
    integrityDatabase.exec('PRAGMA foreign_keys = ON');
    integrityDatabase.prepare("UPDATE usuarios SET estado_usuario = 'Inactivo' WHERE id_usuario = 1").run();
    assert.throws(
      () => integrityDatabase.prepare("UPDATE usuarios SET estado_usuario = 'Suspendido' WHERE id_usuario = 1").run(),
      /CHECK constraint failed/
    );
    integrityDatabase.prepare("UPDATE celdas SET estado_celda = 'Mantenimiento' WHERE id_celda = 1").run();
    assert.throws(
      () => integrityDatabase.prepare("UPDATE celdas SET estado_celda = 'Cerrada' WHERE id_celda = 1").run(),
      /CHECK constraint failed/
    );
    assert.throws(
      () => integrityDatabase.prepare('DELETE FROM usuarios WHERE id_usuario = 1').run(),
      /FOREIGN KEY constraint failed/
    );
    integrityDatabase.close();

    const cleanupDatabase = new DatabaseSync(databasePath);
    cleanupDatabase.exec(`
      PRAGMA foreign_keys = ON;
      DROP TRIGGER trg_no_borrar_accesos;
      DROP TRIGGER trg_no_modificar_novedades;
      DROP TRIGGER trg_no_borrar_novedades;
      DELETE FROM novedades_vehiculo;
      DELETE FROM registros_acceso;
      DELETE FROM mensualidades;
      DELETE FROM vehiculos;
      DELETE FROM usuarios;
      DELETE FROM celdas;
    `);
    cleanupDatabase.close();

    const emptyUsers = await fetch(`${baseUrl}/api/usuarios`);
    assert.deepEqual(await emptyUsers.json(), []);
    const emptyCells = await fetch(`${baseUrl}/api/celdas`);
    assert.deepEqual(await emptyCells.json(), []);
  } finally {
    child.kill('SIGTERM');
    await once(child, 'exit');
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
