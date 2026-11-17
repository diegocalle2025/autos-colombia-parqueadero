const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');

const app = express();
const PORT = Number(process.env.PORT) || 3000;
const databasePath = process.env.DATABASE_PATH || path.join(__dirname, '..', 'data', 'autos-colombia.sqlite');
const schemaPath = path.join(__dirname, '..', 'modelo_datos', '03_modelo_fisico.sql');

fs.mkdirSync(path.dirname(databasePath), { recursive: true });
const database = new DatabaseSync(databasePath);
database.exec(fs.readFileSync(schemaPath, 'utf8'));
database.exec('PRAGMA foreign_keys = ON');

app.use(cors());
app.use(express.json({ limit: '32kb' }));
app.use(express.static(path.join(__dirname, 'public')));

const CELL_TYPES = new Set(['Automóvil', 'Camioneta', 'Motocicleta']);
const PAYMENT_METHODS = new Set(['Efectivo', 'Transferencia', 'Tarjeta']);
const VEHICLE_RATES = new Map([
  ['Automóvil', 180000],
  ['Camioneta', 210000],
  ['Motocicleta', 90000]
]);

function getRequiredText(body, field, label, maxLength) {
  const value = body?.[field];
  if (typeof value !== 'string' || !value.trim()) {
    return { error: `${label} es obligatorio.` };
  }
  const trimmedValue = value.trim();
  if (trimmedValue.length > maxLength) {
    return { error: `${label} no puede superar ${maxLength} caracteres.` };
  }
  return { value: trimmedValue };
}

function isValidDateOnly(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().startsWith(value);
}

function addDays(date, days) {
  const parsed = new Date(`${date}T00:00:00.000Z`);
  parsed.setUTCDate(parsed.getUTCDate() + days);
  return parsed.toISOString().slice(0, 10);
}

function getPaymentReceipt(paymentId) {
  return database.prepare(`
    SELECT p.id_pago, 'PAG-' || printf('%06d', p.id_pago) AS folio,
           p.fecha_hora_emision, p.fecha_transaccion, p.valor_pagado,
           p.metodo_pago, p.estado_pago, p.operador, p.observaciones,
           p.anulado_por, p.fecha_hora_anulacion, p.motivo_anulacion,
           u.documento_identidad AS documento,
           u.nombres || ' ' || u.apellidos AS usuario,
           p.placa, v.tipo_vehiculo AS tipo_vehiculo,
           m.fecha_inicio, m.fecha_fin, m.id_mensualidad
    FROM pagos p
    JOIN usuarios u ON u.id_usuario = p.id_usuario
    JOIN vehiculos v ON v.placa = p.placa
    JOIN mensualidades m ON m.id_mensualidad = p.id_mensualidad
    WHERE p.id_pago = ?
  `).get(paymentId);
}

app.get('/api/usuarios', (req, res) => {
  const users = database.prepare(`
    SELECT documento_identidad AS documento, nombres, apellidos, telefono,
           correo_electronico AS correo, fecha_registro, estado_usuario AS estado
    FROM usuarios
    ORDER BY nombres COLLATE NOCASE, apellidos COLLATE NOCASE, documento_identidad
  `).all();
  res.json(users);
});

app.post('/api/usuarios', (req, res) => {
  const fields = [
    ['documento_identidad', 'documento de identidad', 40],
    ['nombres', 'nombres', 100],
    ['apellidos', 'apellidos', 100],
    ['telefono', 'teléfono', 30],
    ['correo_electronico', 'correo electrónico', 254]
  ];
  const values = {};
  for (const [field, label, maxLength] of fields) {
    const result = getRequiredText(req.body, field, label, maxLength);
    if (result.error) return res.status(400).json({ error: result.error, campo: field });
    values[field] = result.value;
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(values.correo_electronico)) {
    return res.status(400).json({ error: 'Ingrese un correo electrónico válido.', campo: 'correo_electronico' });
  }

  try {
    const result = database.prepare(`
      INSERT INTO usuarios
        (documento_identidad, nombres, apellidos, telefono, correo_electronico)
      VALUES (?, ?, ?, ?, ?)
    `).run(
      values.documento_identidad,
      values.nombres,
      values.apellidos,
      values.telefono,
      values.correo_electronico
    );
    const user = database.prepare(`
      SELECT documento_identidad AS documento, nombres, apellidos, telefono,
             correo_electronico AS correo, fecha_registro, estado_usuario AS estado
      FROM usuarios WHERE id_usuario = ?
    `).get(Number(result.lastInsertRowid));
    return res.status(201).json({ mensaje: 'Usuario registrado correctamente.', usuario: user });
  } catch (error) {
    if (error.code === 'ERR_SQLITE_ERROR'
        && String(error.message).includes('UNIQUE constraint failed: usuarios.documento_identidad')) {
      return res.status(409).json({ error: 'El documento de identidad ya está registrado.', campo: 'documento_identidad' });
    }
    console.error('Error al registrar usuario:', error.message);
    return res.status(500).json({ error: 'No fue posible registrar el usuario.' });
  }
});

app.get('/api/celdas', (req, res) => {
  const cells = database.prepare(`
    SELECT codigo_celda AS codigo, tipo_permitido AS tipo,
           estado_celda AS estado, ubicacion_sector AS ubicacion
    FROM celdas
    ORDER BY codigo_celda
  `).all();
  res.json(cells);
});

app.post('/api/celdas', (req, res) => {
  const fields = [
    ['codigo_celda', 'código de celda', 30],
    ['tipo_permitido', 'tipo de vehículo', 30],
    ['ubicacion_sector', 'ubicación o sector', 100]
  ];
  const values = {};
  for (const [field, label, maxLength] of fields) {
    const result = getRequiredText(req.body, field, label, maxLength);
    if (result.error) return res.status(400).json({ error: result.error, campo: field });
    values[field] = result.value;
  }
  if (!CELL_TYPES.has(values.tipo_permitido)) {
    return res.status(400).json({
      error: 'El tipo de vehículo debe ser Automóvil, Camioneta o Motocicleta.',
      campo: 'tipo_permitido'
    });
  }

  try {
    database.prepare(`
      INSERT INTO celdas (codigo_celda, tipo_permitido, ubicacion_sector)
      VALUES (?, ?, ?)
    `).run(values.codigo_celda, values.tipo_permitido, values.ubicacion_sector);
    const cell = database.prepare(`
      SELECT codigo_celda AS codigo, tipo_permitido AS tipo,
             estado_celda AS estado, ubicacion_sector AS ubicacion
      FROM celdas WHERE codigo_celda = ?
    `).get(values.codigo_celda);
    return res.status(201).json({ mensaje: 'Celda registrada correctamente.', celda: cell });
  } catch (error) {
    if (error.code === 'ERR_SQLITE_ERROR'
        && String(error.message).includes('UNIQUE constraint failed: celdas.codigo_celda')) {
      return res.status(409).json({ error: 'El código de celda ya está registrado.', campo: 'codigo_celda' });
    }
    console.error('Error al registrar celda:', error.message);
    return res.status(500).json({ error: 'No fue posible registrar la celda.' });
  }
});

function getNoveltyList(accessId) {
  return database.prepare(`
    SELECT id_novedad, id_acceso, momento_registro AS momento,
           tipo_novedad AS tipo, descripcion, fecha_hora_registro AS fecha_hora
    FROM novedades_vehiculo
    WHERE id_acceso = ?
    ORDER BY fecha_hora_registro, id_novedad
  `).all(accessId);
}

function getActiveAccess(plate) {
  return database.prepare(`
    SELECT id_acceso FROM registros_acceso
    WHERE placa = ? AND estado_acceso = 'En Parqueadero'
  `).get(plate);
}

function getCurrentMembership(userId) {
  return database.prepare(`
    SELECT * FROM mensualidades
    WHERE id_usuario = ?
      AND estado_mensualidad = 'Vigente'
      AND date('now', 'localtime') BETWEEN date(fecha_inicio) AND date(fecha_fin)
    ORDER BY date(fecha_fin) DESC, id_mensualidad DESC
    LIMIT 1
  `).get(userId);
}

function isValidPlate(plate) {
  return /^[A-Z0-9]{5,7}$/.test(plate);
}

function makeTicket(accessId) {
  const ticket = database.prepare(`
    SELECT r.id_acceso AS folio, r.placa, v.tipo_vehiculo AS tipo,
           v.marca, v.modelo, u.nombres || ' ' || u.apellidos AS cliente,
           c.codigo_celda AS celda, r.fecha_hora_entrada AS fecha_hora,
           r.operador_entrada AS operador
    FROM registros_acceso r
    JOIN vehiculos v ON v.placa = r.placa
    JOIN usuarios u ON u.id_usuario = v.id_usuario
    JOIN celdas c ON c.id_celda = r.id_celda
    WHERE r.id_acceso = ?
  `).get(accessId);
  if (ticket) ticket.novedades = getNoveltyList(accessId);
  return ticket;
}

app.get('/api/patio', (req, res) => {
  const celdas = database.prepare(`
    SELECT id_celda, codigo_celda AS codigo, tipo_permitido AS tipo,
           estado_celda AS estado, ubicacion_sector AS sector
    FROM celdas ORDER BY codigo_celda
  `).all();

  const activos = database.prepare(`
    SELECT r.id_acceso, r.placa, v.tipo_vehiculo AS tipo, v.marca, v.modelo, v.color,
           u.nombres || ' ' || u.apellidos AS cliente, u.telefono,
           r.id_celda, c.codigo_celda AS codigo_celda,
           r.fecha_hora_entrada, r.operador_entrada
    FROM registros_acceso r
    JOIN vehiculos v ON v.placa = r.placa
    JOIN usuarios u ON u.id_usuario = v.id_usuario
    JOIN celdas c ON c.id_celda = r.id_celda
    WHERE r.estado_acceso = 'En Parqueadero'
    ORDER BY r.fecha_hora_entrada
  `).all().map(access => ({ ...access, novedades: getNoveltyList(access.id_acceso) }));

  const celdasOcupadas = celdas.filter(cell => cell.estado === 'Ocupada').length;
  res.json({
    estadisticas: {
      totalCeldas: celdas.length,
      celdasOcupadas,
      celdasDisponibles: celdas.filter(cell => cell.estado === 'Disponible').length
    },
    celdas,
    activos
  });
});

app.post('/api/validar-placa', (req, res) => {
  const placa = String(req.body?.placa || '').trim().toUpperCase();
  if (!isValidPlate(placa)) {
    return res.status(400).json({ valido: false, mensaje: 'Ingrese una placa alfanumerica valida.' });
  }

  const activeAccess = getActiveAccess(placa);
  if (activeAccess) {
    return res.status(409).json({
      valido: false,
      yaIngresado: true,
      mensaje: `El vehiculo ${placa} ya se encuentra dentro del parqueadero.`
    });
  }

  const vehicle = database.prepare('SELECT * FROM vehiculos WHERE placa = ?').get(placa);
  if (!vehicle) {
    return res.status(404).json({ valido: false, mensaje: `La placa ${placa} no esta registrada.` });
  }

  const usuario = database.prepare('SELECT * FROM usuarios WHERE id_usuario = ?').get(vehicle.id_usuario);
  if (!usuario || usuario.estado_usuario !== 'Activo') {
    return res.status(403).json({ valido: false, mensaje: 'El titular se encuentra inactivo.' });
  }

  const mensualidad = getCurrentMembership(vehicle.id_usuario);
  if (!mensualidad) {
    return res.status(403).json({
      valido: false,
      mensualidadVencida: true,
      mensaje: 'El usuario no tiene una mensualidad vigente para la fecha actual.'
    });
  }

  const celdasDisponibles = database.prepare(`
    SELECT id_celda, codigo_celda AS codigo, tipo_permitido AS tipo,
           estado_celda AS estado, ubicacion_sector AS sector
    FROM celdas
    WHERE tipo_permitido = ? AND estado_celda = 'Disponible'
    ORDER BY codigo_celda
  `).all(vehicle.tipo_vehiculo);

  res.json({ valido: true, vehiculo: { ...vehicle, tipo: vehicle.tipo_vehiculo }, usuario, mensualidad, celdasDisponibles });
});

app.post('/api/entrada', (req, res) => {
  const placa = String(req.body?.placa || '').trim().toUpperCase();
  const idCelda = Number(req.body?.id_celda);
  const noveltyDescription = String(req.body?.novedad || '').trim();
  const noveltyType = String(req.body?.tipo_novedad || 'Otro');
  const operator = String(req.body?.operador || '').trim();

  if (!isValidPlate(placa) || !Number.isInteger(idCelda) || idCelda < 1 || !operator) {
    return res.status(400).json({ error: 'Placa, celda y operador son obligatorios y deben ser validos.' });
  }
  if (req.body?.registrar_novedad && !noveltyDescription) {
    return res.status(400).json({ error: 'La descripcion de la novedad no puede estar vacia.' });
  }
  if (!['Carroceria', 'Carrocería', 'Vidrios', 'Llantas', 'Objetos', 'Otro'].includes(noveltyType)) {
    return res.status(400).json({ error: 'El tipo de novedad no esta permitido.' });
  }

  try {
    database.exec('BEGIN IMMEDIATE');
    const vehicle = database.prepare('SELECT * FROM vehiculos WHERE placa = ?').get(placa);
    const cell = database.prepare('SELECT * FROM celdas WHERE id_celda = ?').get(idCelda);
    const user = vehicle && database.prepare('SELECT * FROM usuarios WHERE id_usuario = ?').get(vehicle.id_usuario);
    if (!vehicle || !user || user.estado_usuario !== 'Activo') {
      database.exec('ROLLBACK');
      return res.status(404).json({ error: 'Vehiculo o titular activo no encontrado.' });
    }
    if (!getCurrentMembership(vehicle.id_usuario)) {
      database.exec('ROLLBACK');
      return res.status(403).json({ error: 'La mensualidad no esta vigente para la fecha actual.' });
    }
    if (getActiveAccess(placa)) {
      database.exec('ROLLBACK');
      return res.status(409).json({ error: 'El vehiculo ya tiene una entrada activa.' });
    }
    if (!cell || cell.estado_celda !== 'Disponible' || cell.tipo_permitido !== vehicle.tipo_vehiculo) {
      database.exec('ROLLBACK');
      return res.status(409).json({ error: 'La celda no esta disponible o no es compatible con el vehiculo.' });
    }

    const entryTime = new Date().toISOString();
    const result = database.prepare(`
      INSERT INTO registros_acceso (placa, id_celda, fecha_hora_entrada, operador_entrada)
      VALUES (?, ?, ?, ?)
    `).run(placa, idCelda, entryTime, operator);
    const accessId = Number(result.lastInsertRowid);
    database.prepare("UPDATE celdas SET estado_celda = 'Ocupada' WHERE id_celda = ?").run(idCelda);
    if (noveltyDescription) {
      const normalizedType = noveltyType === 'Carroceria' ? 'Carrocería' : noveltyType;
      database.prepare(`
        INSERT INTO novedades_vehiculo (id_acceso, momento_registro, tipo_novedad, descripcion)
        VALUES (?, 'Entrada', ?, ?)
      `).run(accessId, normalizedType, noveltyDescription);
    }
    database.exec('COMMIT');
    res.status(201).json({ mensaje: 'Ingreso registrado satisfactoriamente', acceso: { id_acceso: accessId }, celda: cell.codigo_celda, ticket: makeTicket(accessId) });
  } catch (error) {
    if (database.isTransaction) database.exec('ROLLBACK');
    if (String(error.message).includes('UNIQUE constraint failed')) {
      return res.status(409).json({ error: 'La placa o la celda ya tienen un acceso activo.' });
    }
    console.error('Error al registrar entrada:', error.message);
    res.status(500).json({ error: 'No fue posible registrar la entrada.' });
  }
});

app.post('/api/salida', (req, res) => {
  const accessId = Number(req.body?.id_acceso);
  const noveltyDescription = String(req.body?.novedad_salida || '').trim();
  const operator = String(req.body?.operador || '').trim();
  if (!Number.isInteger(accessId) || accessId < 1 || !operator) {
    return res.status(400).json({ error: 'El acceso y el operador son obligatorios.' });
  }

  try {
    database.exec('BEGIN IMMEDIATE');
    const access = database.prepare(`
      SELECT * FROM registros_acceso
      WHERE id_acceso = ? AND estado_acceso = 'En Parqueadero'
    `).get(accessId);
    if (!access) {
      database.exec('ROLLBACK');
      return res.status(404).json({ error: 'Registro de acceso activo no encontrado.' });
    }
    const now = new Date().toISOString();
    const minutes = Math.max(0, Math.round((Date.now() - new Date(access.fecha_hora_entrada).getTime()) / 60000));
    database.prepare(`
      UPDATE registros_acceso
      SET fecha_hora_salida = ?, estado_acceso = 'Finalizado',
          tiempo_permanencia_minutos = ?, operador_salida = ?
      WHERE id_acceso = ?
    `).run(now, minutes, operator, accessId);
    database.prepare("UPDATE celdas SET estado_celda = 'Disponible' WHERE id_celda = ?").run(access.id_celda);
    if (noveltyDescription) {
      database.prepare(`
        INSERT INTO novedades_vehiculo (id_acceso, momento_registro, tipo_novedad, descripcion)
        VALUES (?, 'Salida', 'Otro', ?)
      `).run(accessId, noveltyDescription);
    }
    database.exec('COMMIT');
    const cell = database.prepare('SELECT codigo_celda FROM celdas WHERE id_celda = ?').get(access.id_celda);
    res.json({ mensaje: 'Salida registrada correctamente y celda liberada', acceso: { ...access, estado_acceso: 'Finalizado', fecha_hora_salida: now, tiempo_permanencia_minutos: minutes }, celdaLiberada: cell.codigo_celda, minutosEstadia: minutes });
  } catch (error) {
    if (database.isTransaction) database.exec('ROLLBACK');
    console.error('Error al registrar salida:', error.message);
    res.status(500).json({ error: 'No fue posible registrar la salida.' });
  }
});

app.get('/api/tickets/:id', (req, res) => {
  const ticket = makeTicket(Number(req.params.id));
  if (!ticket) return res.status(404).json({ error: 'Ticket no encontrado.' });
  res.json(ticket);
});

app.get('/api/historico', (req, res) => {
  const conditions = [];
  const parameters = [];
  const plate = String(req.query.placa || '').trim().toUpperCase();
  const from = String(req.query.desde || '').trim();
  const to = String(req.query.hasta || '').trim();
  const validDate = value => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
    const parsed = new Date(`${value}T00:00:00.000Z`);
    return !Number.isNaN(parsed.getTime()) && parsed.toISOString().startsWith(value);
  };
  if ((from && !validDate(from)) || (to && !validDate(to)) || (from && to && from > to)) {
    return res.status(400).json({ error: 'El rango de fechas no es valido.' });
  }
  if (plate) {
    conditions.push('r.placa LIKE ?');
    parameters.push(`%${plate}%`);
  }
  if (from) {
    conditions.push("date(r.fecha_hora_entrada, 'localtime') >= date(?)");
    parameters.push(from);
  }
  if (to) {
    conditions.push("date(r.fecha_hora_entrada, 'localtime') <= date(?)");
    parameters.push(to);
  }
  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const records = database.prepare(`
    SELECT r.id_acceso, r.placa, u.nombres || ' ' || u.apellidos AS cliente,
           v.tipo_vehiculo AS tipo, c.codigo_celda AS celda,
           r.fecha_hora_entrada AS entrada, r.fecha_hora_salida AS salida,
           r.tiempo_permanencia_minutos AS minutos, r.estado_acceso AS estado,
           r.operador_entrada AS operador, r.operador_salida
    FROM registros_acceso r
    JOIN vehiculos v ON v.placa = r.placa
    JOIN usuarios u ON u.id_usuario = v.id_usuario
    JOIN celdas c ON c.id_celda = r.id_celda
    ${where}
    ORDER BY r.fecha_hora_entrada DESC, r.id_acceso DESC
  `).all(...parameters);
  res.json(records.map(record => ({ ...record, novedades: getNoveltyList(record.id_acceso) })));
});

app.get('/api/mensualistas', (req, res) => {
  const records = database.prepare(`
    SELECT v.placa, v.tipo_vehiculo AS tipo, v.marca, v.modelo, v.color,
           u.nombres || ' ' || u.apellidos AS cliente,
           u.documento_identidad AS documento, u.telefono,
           CASE
             WHEN m.id_mensualidad IS NULL THEN 'Sin plan'
             WHEN m.estado_mensualidad = 'Vigente'
               AND date('now', 'localtime') BETWEEN date(m.fecha_inicio) AND date(m.fecha_fin)
               THEN 'Vigente'
             WHEN m.estado_mensualidad = 'Cancelada' THEN 'Cancelada'
             ELSE 'Vencida'
           END AS estadoMensualidad,
           COALESCE(m.fecha_fin, 'N/A') AS fechaFin
    FROM vehiculos v
    JOIN usuarios u ON u.id_usuario = v.id_usuario
    LEFT JOIN mensualidades m ON m.id_mensualidad = (
      SELECT MAX(m2.id_mensualidad) FROM mensualidades m2 WHERE m2.id_usuario = u.id_usuario
    )
    ORDER BY v.placa
  `).all();
  res.json(records);
});

app.get('/api/pagos/vehiculos', (req, res) => {
  const vehicles = database.prepare(`
    SELECT v.placa, v.tipo_vehiculo AS tipo, v.marca, v.modelo,
           u.id_usuario, u.documento_identidad AS documento,
           u.nombres || ' ' || u.apellidos AS usuario
    FROM vehiculos v
    JOIN usuarios u ON u.id_usuario = v.id_usuario
    WHERE u.estado_usuario = 'Activo'
    ORDER BY u.apellidos COLLATE NOCASE, u.nombres COLLATE NOCASE, v.placa
  `).all();
  res.json(vehicles);
});

app.get('/api/pagos/tarifa', (req, res) => {
  const plate = String(req.query.placa || '').trim().toUpperCase();
  if (!plate) return res.status(400).json({ error: 'La placa es obligatoria.' });
  const vehicle = database.prepare(`
    SELECT v.placa, v.tipo_vehiculo AS tipo, u.estado_usuario AS estado_usuario
    FROM vehiculos v
    JOIN usuarios u ON u.id_usuario = v.id_usuario
    WHERE v.placa = ?
  `).get(plate);
  if (!vehicle) return res.status(404).json({ error: 'No se encontró el vehículo.' });
  if (vehicle.estado_usuario !== 'Activo') {
    return res.status(403).json({ error: 'El titular del vehículo se encuentra inactivo.' });
  }
  res.json({ placa: vehicle.placa, tipo: vehicle.tipo, valor_sugerido: VEHICLE_RATES.get(vehicle.tipo) });
});

app.get('/api/pagos', (req, res) => {
  const conditions = [];
  const parameters = [];
  const document = String(req.query.documento || '').trim();
  const plate = String(req.query.placa || '').trim().toUpperCase();
  const method = String(req.query.metodo || '').trim();
  const from = String(req.query.desde || '').trim();
  const to = String(req.query.hasta || '').trim();
  if ((from && !isValidDateOnly(from)) || (to && !isValidDateOnly(to)) || (from && to && from > to)) {
    return res.status(400).json({ error: 'El rango de fechas no es válido.' });
  }
  if (method && !PAYMENT_METHODS.has(method)) {
    return res.status(400).json({ error: 'El método de pago no está permitido.' });
  }
  if (document) {
    conditions.push('u.documento_identidad LIKE ?');
    parameters.push(`%${document}%`);
  }
  if (plate) {
    conditions.push('p.placa LIKE ?');
    parameters.push(`%${plate}%`);
  }
  if (method) {
    conditions.push('p.metodo_pago = ?');
    parameters.push(method);
  }
  if (from) {
    conditions.push('date(p.fecha_transaccion) >= date(?)');
    parameters.push(from);
  }
  if (to) {
    conditions.push('date(p.fecha_transaccion) <= date(?)');
    parameters.push(to);
  }
  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const payments = database.prepare(`
    SELECT p.id_pago, 'PAG-' || printf('%06d', p.id_pago) AS folio,
           p.fecha_transaccion, p.fecha_hora_emision, p.valor_pagado,
           p.metodo_pago, p.estado_pago, p.operador, p.observaciones,
           p.anulado_por, p.fecha_hora_anulacion, p.motivo_anulacion,
           u.documento_identidad AS documento,
           u.nombres || ' ' || u.apellidos AS usuario,
           p.placa, v.tipo_vehiculo AS tipo_vehiculo,
           m.fecha_inicio, m.fecha_fin
    FROM pagos p
    JOIN usuarios u ON u.id_usuario = p.id_usuario
    JOIN vehiculos v ON v.placa = p.placa
    JOIN mensualidades m ON m.id_mensualidad = p.id_mensualidad
    ${where}
    ORDER BY p.id_pago DESC
  `).all(...parameters);
  res.json(payments);
});

app.get('/api/mensualidades', (req, res) => {
  const state = String(req.query.estado || '').trim();
  const upcomingOnly = ['1', 'true'].includes(String(req.query.proximas || '').toLowerCase());
  if (state && !['Vigente', 'Vencida', 'Cancelada'].includes(state)) {
    return res.status(400).json({ error: 'El estado de mensualidad no está permitido.' });
  }
  const conditions = [];
  const parameters = [];
  if (state) {
    conditions.push(`CASE
      WHEN m.estado_mensualidad = 'Cancelada' THEN 'Cancelada'
      WHEN date(m.fecha_fin) < date('now', 'localtime') THEN 'Vencida'
      ELSE 'Vigente'
    END = ?`);
    parameters.push(state);
  }
  if (upcomingOnly) {
    conditions.push(`m.estado_mensualidad != 'Cancelada'
      AND date(m.fecha_fin) BETWEEN date('now', 'localtime')
      AND date('now', 'localtime', '+5 days')`);
  }
  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const memberships = database.prepare(`
    SELECT m.id_mensualidad, m.id_usuario, u.documento_identidad AS documento,
           u.nombres || ' ' || u.apellidos AS usuario,
           p.placa, v.tipo_vehiculo AS tipo_vehiculo,
           m.fecha_inicio, m.fecha_fin, m.valor_pagado,
           CASE
             WHEN m.estado_mensualidad = 'Cancelada' THEN 'Cancelada'
             WHEN date(m.fecha_fin) < date('now', 'localtime') THEN 'Vencida'
             ELSE 'Vigente'
           END AS estado,
           CAST(julianday(date(m.fecha_fin)) - julianday(date('now', 'localtime')) AS INTEGER) AS dias_para_vencer
    FROM mensualidades m
    JOIN usuarios u ON u.id_usuario = m.id_usuario
    LEFT JOIN pagos p ON p.id_mensualidad = m.id_mensualidad
    LEFT JOIN vehiculos v ON v.placa = p.placa
    ${where}
    ORDER BY date(m.fecha_fin), m.id_mensualidad DESC
  `).all(...parameters);
  res.json(memberships.map(membership => ({
    ...membership,
    por_vencer: membership.estado === 'Vigente'
      && membership.dias_para_vencer >= 0
      && membership.dias_para_vencer <= 5
  })));
});

app.get('/api/pagos/:id', (req, res) => {
  const paymentId = Number(req.params.id);
  if (!Number.isInteger(paymentId) || paymentId < 1) {
    return res.status(400).json({ error: 'El identificador del pago no es válido.' });
  }
  const receipt = getPaymentReceipt(paymentId);
  if (!receipt) return res.status(404).json({ error: 'No se encontró el pago.' });
  res.json(receipt);
});

app.post('/api/pagos', (req, res) => {
  const plate = String(req.body?.placa || '').trim().toUpperCase();
  const amount = Number(req.body?.valor_pagado);
  const method = String(req.body?.metodo_pago || '').trim();
  const transactionDate = req.body?.fecha_transaccion;
  const operator = String(req.body?.operador || '').trim();
  const observations = req.body?.observaciones == null ? '' : String(req.body.observaciones).trim();

  if (!plate || !Number.isSafeInteger(amount) || amount <= 0
      || !PAYMENT_METHODS.has(method) || !isValidDateOnly(transactionDate)
      || !operator || operator.length > 100 || observations.length > 500) {
    return res.status(400).json({
      error: 'Placa, monto positivo en pesos, método permitido, fecha válida y operador son obligatorios; las observaciones no pueden superar 500 caracteres.'
    });
  }

  try {
    database.exec('BEGIN IMMEDIATE');
    const vehicle = database.prepare(`
      SELECT v.placa, v.tipo_vehiculo, u.id_usuario, u.estado_usuario
      FROM vehiculos v
      JOIN usuarios u ON u.id_usuario = v.id_usuario
      WHERE v.placa = ?
    `).get(plate);
    if (!vehicle) {
      database.exec('ROLLBACK');
      return res.status(404).json({ error: 'No se encontró el vehículo registrado.' });
    }
    if (vehicle.estado_usuario !== 'Activo') {
      database.exec('ROLLBACK');
      return res.status(403).json({ error: 'El titular del vehículo se encuentra inactivo.' });
    }

    const previousMembership = database.prepare(`
      SELECT fecha_inicio, fecha_fin, estado_mensualidad
      FROM mensualidades
      WHERE id_usuario = ?
      ORDER BY date(fecha_fin) DESC, id_mensualidad DESC
      LIMIT 1
    `).get(vehicle.id_usuario);
    const membershipStart = previousMembership
      && previousMembership.estado_mensualidad !== 'Cancelada'
      && previousMembership.fecha_fin >= transactionDate
      ? addDays(previousMembership.fecha_fin, 1)
      : transactionDate;
    const membershipEnd = addDays(membershipStart, 29);
    const membershipResult = database.prepare(`
      INSERT INTO mensualidades
        (id_usuario, fecha_inicio, fecha_fin, valor_pagado, estado_mensualidad)
      VALUES (?, ?, ?, ?, 'Vigente')
    `).run(vehicle.id_usuario, membershipStart, membershipEnd, amount);
    const membershipId = Number(membershipResult.lastInsertRowid);
    const paymentResult = database.prepare(`
      INSERT INTO pagos
        (id_usuario, placa, id_mensualidad, valor_pagado, metodo_pago,
         fecha_transaccion, operador, observaciones)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      vehicle.id_usuario,
      plate,
      membershipId,
      amount,
      method,
      transactionDate,
      operator,
      observations || null
    );
    const paymentId = Number(paymentResult.lastInsertRowid);
    database.exec('COMMIT');

    const receipt = getPaymentReceipt(paymentId);
    return res.status(201).json({
      mensaje: 'Pago registrado correctamente.',
      pago: receipt,
      mensualidad: {
        id_mensualidad: membershipId,
        fecha_inicio: membershipStart,
        fecha_fin: membershipEnd,
        estado: 'Vigente'
      }
    });
  } catch (error) {
    if (database.isTransaction) database.exec('ROLLBACK');
    console.error('Error al registrar pago:', error.message);
    return res.status(500).json({ error: 'No fue posible registrar el pago.' });
  }
});

app.post('/api/pagos/:id/anular', (req, res) => {
  const paymentId = Number(req.params.id);
  const role = String(req.body?.rol || '').trim();
  const operator = String(req.body?.operador || '').trim();
  const reason = String(req.body?.motivo || '').trim();
  if (!Number.isInteger(paymentId) || paymentId < 1 || !operator || operator.length > 100 || !reason) {
    return res.status(400).json({ error: 'Identificador, administrador responsable y motivo de anulación son obligatorios.' });
  }
  if (role !== 'Administrador') {
    return res.status(403).json({ error: 'Solo el rol Administrador puede anular pagos.' });
  }

  try {
    database.exec('BEGIN IMMEDIATE');
    const payment = database.prepare(`
      SELECT id_pago, id_mensualidad, estado_pago
      FROM pagos WHERE id_pago = ?
    `).get(paymentId);
    if (!payment) {
      database.exec('ROLLBACK');
      return res.status(404).json({ error: 'No se encontró el pago.' });
    }
    if (payment.estado_pago !== 'Confirmado') {
      database.exec('ROLLBACK');
      return res.status(409).json({ error: 'El pago ya fue anulado y no se puede modificar.' });
    }
    const now = new Date().toISOString();
    database.prepare(`
      UPDATE pagos
      SET estado_pago = 'Anulado', anulado_por = ?, fecha_hora_anulacion = ?,
          motivo_anulacion = ?
      WHERE id_pago = ?
    `).run(operator, now, reason, paymentId);
    database.prepare(`
      UPDATE mensualidades SET estado_mensualidad = 'Cancelada'
      WHERE id_mensualidad = ?
    `).run(payment.id_mensualidad);
    database.exec('COMMIT');
    return res.json({
      mensaje: 'Pago anulado correctamente.',
      pago: getPaymentReceipt(paymentId)
    });
  } catch (error) {
    if (database.isTransaction) database.exec('ROLLBACK');
    console.error('Error al anular pago:', error.message);
    return res.status(500).json({ error: 'No fue posible anular el pago.' });
  }
});

app.get('/api/health', (req, res) => {
  res.json({ ok: true, database: 'sqlite' });
});

const server = app.listen(PORT, () => {
  console.log(`Servidor de Autos Colombia en ejecucion: http://localhost:${PORT}`);
});

function closeServer() {
  server.close(() => {
    database.close();
    process.exit(0);
  });
}

process.once('SIGINT', closeServer);
process.once('SIGTERM', closeServer);
