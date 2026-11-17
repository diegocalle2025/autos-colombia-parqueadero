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
      DROP TRIGGER IF EXISTS trg_no_borrar_accesos;
      DROP TRIGGER IF EXISTS trg_no_modificar_novedades;
      DROP TRIGGER IF EXISTS trg_no_borrar_novedades;
      DROP TRIGGER IF EXISTS trg_no_borrar_pagos;
      DELETE FROM novedades_vehiculo;
      DELETE FROM registros_acceso;
      DELETE FROM pagos;
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
    try {
      fs.rmSync(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    } catch {}
  }
});

test('Gestión de pagos y mensualidades aplica reglas de negocio, arqueo, liquidación y auditoría (Iteración 3)', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'autos-colombia-pagos-test-'));
  const databasePath = path.join(directory, 'test.sqlite');
  const port = await getFreePort();
  const baseUrl = `http://127.0.0.1:${port}`;
  const child = spawn(process.execPath, ['src/server.js'], {
    cwd: path.join(__dirname, '..'),
    env: { ...process.env, PORT: String(port), DATABASE_PATH: databasePath },
    stdio: ['ignore', 'pipe', 'pipe']
  });

  try {
    const started = new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Server did not start within timeout')), 10000);
      child.stdout.on('data', chunk => {
        if (chunk.includes('Servidor de Autos Colombia')) {
          clearTimeout(timeout);
          resolve();
        }
      });
      child.once('error', reject);
      child.once('exit', code => reject(new Error(`Server exited with code ${code}`)));
    });
    await started;

    // PAG-05: Liquidar tarifas por tipo de vehículo
    const tarifaAuto = await (await fetch(`${baseUrl}/api/pagos/tarifa?placa=ABC123`)).json();
    assert.equal(tarifaAuto.valor_sugerido, 180000);
    assert.equal(tarifaAuto.tipo, 'Automóvil');

    const tarifaCamioneta = await (await fetch(`${baseUrl}/api/pagos/tarifa?placa=XYZ789`)).json();
    assert.equal(tarifaCamioneta.valor_sugerido, 210000);

    const tarifaMoto = await (await fetch(`${baseUrl}/api/pagos/tarifa?placa=MTO45D`)).json();
    assert.equal(tarifaMoto.valor_sugerido, 90000);

    const tarifaInvalida = await fetch(`${baseUrl}/api/pagos/tarifa?placa=ZZZ999`);
    assert.equal(tarifaInvalida.status, 404);

    // Listar vehículos disponibles para pago
    const vehiculosResp = await fetch(`${baseUrl}/api/pagos/vehiculos`);
    assert.equal(vehiculosResp.status, 200);
    const vehiculos = await vehiculosResp.json();
    assert.ok(vehiculos.length >= 4);

    // PAG-03 y PAG-04: Validar rechazo de datos inválidos
    const pagoMontoInvalido = await fetch(`${baseUrl}/api/pagos`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        placa: 'ABC123',
        valor_pagado: -50000,
        metodo_pago: 'Efectivo',
        fecha_transaccion: '2026-11-16',
        operador: 'Operador QA'
      })
    });
    assert.equal(pagoMontoInvalido.status, 400);

    const pagoMetodoInvalido = await fetch(`${baseUrl}/api/pagos`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        placa: 'ABC123',
        valor_pagado: 180000,
        metodo_pago: 'Criptomoneda',
        fecha_transaccion: '2026-11-16',
        operador: 'Operador QA'
      })
    });
    assert.equal(pagoMetodoInvalido.status, 400);

    const pagoVehiculoInexistente = await fetch(`${baseUrl}/api/pagos`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        placa: 'NOP999',
        valor_pagado: 180000,
        metodo_pago: 'Efectivo',
        fecha_transaccion: '2026-11-16',
        operador: 'Operador QA'
      })
    });
    assert.equal(pagoVehiculoInexistente.status, 404);

    // PAG-01, PAG-02 y PAG-08: Registrar pago exitoso para mensualidad vencida (MTO45D)
    const t0 = Date.now();
    const pagoMotoResp = await fetch(`${baseUrl}/api/pagos`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        placa: 'MTO45D',
        valor_pagado: 90000,
        metodo_pago: 'Efectivo',
        fecha_transaccion: '2026-11-16',
        operador: 'Operador Portería',
        observaciones: 'Pago en ventanilla mensualidad moto'
      })
    });
    const t1 = Date.now();
    assert.ok(t1 - t0 < 1500, 'PAG-18: El procesamiento del pago debe completarse en menos de 1.5s');
    assert.equal(pagoMotoResp.status, 201);
    const pagoMotoData = await pagoMotoResp.json();
    assert.ok(pagoMotoData.pago.folio.startsWith('PAG-'));
    assert.equal(pagoMotoData.mensualidad.estado, 'Vigente');
    assert.equal(pagoMotoData.mensualidad.fecha_inicio, '2026-11-16');
    assert.equal(pagoMotoData.mensualidad.fecha_fin, '2026-12-15');

    // PAG-09 y PAG-10: Consultar comprobante/recibo individual
    const reciboResp = await fetch(`${baseUrl}/api/pagos/${pagoMotoData.pago.id_pago}`);
    assert.equal(reciboResp.status, 200);
    const recibo = await reciboResp.json();
    assert.equal(recibo.placa, 'MTO45D');
    assert.equal(recibo.valor_pagado, 90000);
    assert.equal(recibo.metodo_pago, 'Efectivo');
    assert.equal(recibo.estado_pago, 'Confirmado');
    assert.equal(recibo.operador, 'Operador Portería');

    // PAG-07: Registrar renovación anticipada de mensualidad aún vigente (KLR890)
    const pagoRenovacionResp = await fetch(`${baseUrl}/api/pagos`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        placa: 'KLR890',
        valor_pagado: 180000,
        metodo_pago: 'Transferencia',
        fecha_transaccion: '2026-11-16',
        operador: 'Administrador'
      })
    });
    assert.equal(pagoRenovacionResp.status, 201);
    const pagoRenovacion = await pagoRenovacionResp.json();
    assert.equal(pagoRenovacion.mensualidad.estado, 'Vigente');

    // PAG-11 y PAG-12: Consultar historial con filtros
    const historialPlaca = await (await fetch(`${baseUrl}/api/pagos?placa=MTO45D`)).json();
    assert.ok(historialPlaca.length >= 1);
    assert.ok(historialPlaca.every(p => p.placa === 'MTO45D'));

    const historialMetodo = await (await fetch(`${baseUrl}/api/pagos?metodo=Transferencia`)).json();
    assert.ok(historialMetodo.every(p => p.metodo_pago === 'Transferencia'));

    const historialVacio = await (await fetch(`${baseUrl}/api/pagos?documento=9999999999`)).json();
    assert.deepEqual(historialVacio, []);

    // PAG-13 y PAG-14: Consultar mensualidades y próximas a vencer
    const mensualidadesVigentes = await (await fetch(`${baseUrl}/api/mensualidades?estado=Vigente`)).json();
    assert.ok(mensualidadesVigentes.length >= 1);
    assert.ok(mensualidadesVigentes.every(m => m.estado === 'Vigente'));

    const mensualidadesProximas = await (await fetch(`${baseUrl}/api/mensualidades?proximas=true`)).json();
    assert.ok(Array.isArray(mensualidadesProximas));

    // PAG-15 y PAG-16: Anulación de pago bajo rol Administrador con justificación
    // Intento 1: Rechazo si falta motivo
    const anularSinMotivo = await fetch(`${baseUrl}/api/pagos/${pagoMotoData.pago.id_pago}/anular`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ rol: 'Administrador', operador: 'Admin Principal', motivo: '' })
    });
    assert.equal(anularSinMotivo.status, 400);

    // Intento 2: Rechazo si el rol no es Administrador
    const anularRolNoAutorizado = await fetch(`${baseUrl}/api/pagos/${pagoMotoData.pago.id_pago}/anular`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ rol: 'Operador de Portería', operador: 'Operador Ventanilla', motivo: 'Error en digitación' })
    });
    assert.equal(anularRolNoAutorizado.status, 403);

    // Intento 3: Anulación exitosa como Administrador
    const anularExitoso = await fetch(`${baseUrl}/api/pagos/${pagoMotoData.pago.id_pago}/anular`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        rol: 'Administrador',
        operador: 'Admin Principal',
        motivo: 'Comprobante duplicado por error de digitación del cajero'
      })
    });
    assert.equal(anularExitoso.status, 200);
    const anuladoData = await anularExitoso.json();
    assert.equal(anuladoData.pago.estado_pago, 'Anulado');
    assert.equal(anuladoData.pago.anulado_por, 'Admin Principal');
    assert.ok(anuladoData.pago.motivo_anulacion.includes('Comprobante duplicado'));

    // Intento 4: Intentar re-anular pago ya anulado
    const reanular = await fetch(`${baseUrl}/api/pagos/${pagoMotoData.pago.id_pago}/anular`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ rol: 'Administrador', operador: 'Admin', motivo: 'Reintento' })
    });
    assert.equal(reanular.status, 409);

    // PAG-17: Comprobar inmutabilidad directamente en SQLite
    const testDb = new DatabaseSync(databasePath);
    assert.throws(
      () => testDb.prepare('DELETE FROM pagos WHERE id_pago = ?').run(pagoMotoData.pago.id_pago),
      /Los pagos registrados son inmutables/
    );
    testDb.close();

    // INT-PAG-04: Validar que el historial conserva el pago anulado para auditoría
    const historialAuditoria = await (await fetch(`${baseUrl}/api/pagos?placa=MTO45D`)).json();
    const pagoEnHistorial = historialAuditoria.find(p => p.id_pago === pagoMotoData.pago.id_pago);
    assert.ok(pagoEnHistorial);
    assert.equal(pagoEnHistorial.estado_pago, 'Anulado');
  } finally {
    child.kill('SIGTERM');
    await once(child, 'exit');
    try {
      fs.rmSync(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    } catch {}
  }
});
