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
