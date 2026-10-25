PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS usuarios (
    id_usuario INTEGER PRIMARY KEY AUTOINCREMENT,
    documento_identidad TEXT NOT NULL UNIQUE,
    nombres TEXT NOT NULL,
    apellidos TEXT NOT NULL,
    telefono TEXT NOT NULL,
    correo_electronico TEXT NOT NULL,
    estado_usuario TEXT NOT NULL DEFAULT 'Activo' CHECK (estado_usuario IN ('Activo', 'Inactivo')),
    fecha_registro TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE IF NOT EXISTS mensualidades (
    id_mensualidad INTEGER PRIMARY KEY AUTOINCREMENT,
    id_usuario INTEGER NOT NULL,
    fecha_inicio TEXT NOT NULL,
    fecha_fin TEXT NOT NULL,
    valor_pagado NUMERIC NOT NULL CHECK (valor_pagado > 0),
    estado_mensualidad TEXT NOT NULL DEFAULT 'Vigente' CHECK (estado_mensualidad IN ('Vigente', 'Vencida', 'Cancelada')),
    CHECK (fecha_fin >= fecha_inicio),
    FOREIGN KEY (id_usuario) REFERENCES usuarios(id_usuario) ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS vehiculos (
    placa TEXT PRIMARY KEY,
    id_usuario INTEGER NOT NULL,
    tipo_vehiculo TEXT NOT NULL CHECK (tipo_vehiculo IN ('Automóvil', 'Camioneta', 'Motocicleta')),
    marca TEXT NOT NULL,
    modelo TEXT NOT NULL,
    color TEXT NOT NULL,
    FOREIGN KEY (id_usuario) REFERENCES usuarios(id_usuario) ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS celdas (
    id_celda INTEGER PRIMARY KEY AUTOINCREMENT,
    codigo_celda TEXT NOT NULL UNIQUE,
    tipo_permitido TEXT NOT NULL CHECK (tipo_permitido IN ('Automóvil', 'Camioneta', 'Motocicleta')),
    estado_celda TEXT NOT NULL DEFAULT 'Disponible' CHECK (estado_celda IN ('Disponible', 'Ocupada', 'Mantenimiento')),
    ubicacion_sector TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS registros_acceso (
    id_acceso INTEGER PRIMARY KEY AUTOINCREMENT,
    placa TEXT NOT NULL,
    id_celda INTEGER NOT NULL,
    fecha_hora_entrada TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    fecha_hora_salida TEXT,
    estado_acceso TEXT NOT NULL DEFAULT 'En Parqueadero' CHECK (estado_acceso IN ('En Parqueadero', 'Finalizado')),
    tiempo_permanencia_minutos INTEGER CHECK (tiempo_permanencia_minutos IS NULL OR tiempo_permanencia_minutos >= 0),
    operador_entrada TEXT NOT NULL,
    operador_salida TEXT,
    CHECK ((estado_acceso = 'En Parqueadero' AND fecha_hora_salida IS NULL AND tiempo_permanencia_minutos IS NULL) OR (estado_acceso = 'Finalizado' AND fecha_hora_salida IS NOT NULL AND tiempo_permanencia_minutos IS NOT NULL)),
    FOREIGN KEY (placa) REFERENCES vehiculos(placa) ON DELETE RESTRICT,
    FOREIGN KEY (id_celda) REFERENCES celdas(id_celda) ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS novedades_vehiculo (
    id_novedad INTEGER PRIMARY KEY AUTOINCREMENT,
    id_acceso INTEGER NOT NULL,
    momento_registro TEXT NOT NULL CHECK (momento_registro IN ('Entrada', 'Salida', 'Estancia')),
    tipo_novedad TEXT NOT NULL CHECK (tipo_novedad IN ('Carrocería', 'Vidrios', 'Llantas', 'Objetos', 'Otro')),
    descripcion TEXT NOT NULL CHECK (length(trim(descripcion)) > 0),
    fecha_hora_registro TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    FOREIGN KEY (id_acceso) REFERENCES registros_acceso(id_acceso) ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS idx_mensualidades_usuario_vigencia ON mensualidades(id_usuario, estado_mensualidad, fecha_inicio, fecha_fin);
CREATE INDEX IF NOT EXISTS idx_vehiculos_usuario ON vehiculos(id_usuario);
CREATE INDEX IF NOT EXISTS idx_accesos_placa_fecha ON registros_acceso(placa, fecha_hora_entrada);
CREATE INDEX IF NOT EXISTS idx_accesos_estado_fecha ON registros_acceso(estado_acceso, fecha_hora_entrada);
CREATE INDEX IF NOT EXISTS idx_celdas_estado_tipo ON celdas(estado_celda, tipo_permitido);
CREATE UNIQUE INDEX IF NOT EXISTS uq_acceso_activo_placa ON registros_acceso(placa) WHERE estado_acceso = 'En Parqueadero';
CREATE UNIQUE INDEX IF NOT EXISTS uq_acceso_activo_celda ON registros_acceso(id_celda) WHERE estado_acceso = 'En Parqueadero';

CREATE TRIGGER IF NOT EXISTS trg_no_borrar_accesos
BEFORE DELETE ON registros_acceso
BEGIN
    SELECT RAISE(ABORT, 'El historial de accesos es inmutable');
END;

CREATE TRIGGER IF NOT EXISTS trg_no_modificar_accesos_finalizados
BEFORE UPDATE ON registros_acceso
WHEN OLD.estado_acceso = 'Finalizado'
BEGIN
    SELECT RAISE(ABORT, 'Un acceso finalizado es inmutable');
END;

CREATE TRIGGER IF NOT EXISTS trg_no_modificar_novedades
BEFORE UPDATE ON novedades_vehiculo
BEGIN
    SELECT RAISE(ABORT, 'Las novedades registradas son inmutables');
END;

CREATE TRIGGER IF NOT EXISTS trg_no_borrar_novedades
BEFORE DELETE ON novedades_vehiculo
BEGIN
    SELECT RAISE(ABORT, 'Las novedades registradas son inmutables');
END;

INSERT OR IGNORE INTO usuarios (id_usuario, documento_identidad, nombres, apellidos, telefono, correo_electronico) VALUES
(1, '1020304050', 'Carlos', 'Ramirez Gomez', '3104567890', 'carlos.ramirez@email.com'),
(2, '1030405060', 'Diana', 'Restrepo Osorio', '3157891234', 'diana.restrepo@email.com'),
(3, '1040506070', 'Mateo', 'Valencia Castrillon', '3001234567', 'mateo.valencia@email.com'),
(4, '1050607080', 'Laura', 'Quintero', '3209876543', 'laura.quintero@email.com');

INSERT OR IGNORE INTO mensualidades (id_mensualidad, id_usuario, fecha_inicio, fecha_fin, valor_pagado, estado_mensualidad) VALUES
(1, 1, '2026-10-01', '2026-11-01', 180000, 'Vigente'),
(2, 2, '2026-10-05', '2026-11-05', 210000, 'Vigente'),
(3, 3, '2026-09-01', '2026-10-01', 90000, 'Vigente'),
(4, 4, '2026-10-10', '2026-11-10', 180000, 'Vigente');

INSERT OR IGNORE INTO vehiculos (placa, id_usuario, tipo_vehiculo, marca, modelo, color) VALUES
('ABC123', 1, 'Automóvil', 'Mazda', 'Mazda 3', 'Rojo'),
('XYZ789', 2, 'Camioneta', 'Toyota', 'RAV4', 'Gris'),
('MTO45D', 3, 'Motocicleta', 'Yamaha', 'MT-03', 'Negro'),
('KLR890', 4, 'Automóvil', 'Renault', 'Sandero', 'Blanco');

INSERT OR IGNORE INTO celdas (id_celda, codigo_celda, tipo_permitido, estado_celda, ubicacion_sector) VALUES
(1, 'A-01', 'Automóvil', 'Disponible', 'Sector A - Planta 1'),
(2, 'A-02', 'Automóvil', 'Ocupada', 'Sector A - Planta 1'),
(3, 'A-03', 'Automóvil', 'Disponible', 'Sector A - Planta 1'),
(4, 'A-04', 'Automóvil', 'Disponible', 'Sector A - Planta 1'),
(5, 'B-01', 'Camioneta', 'Disponible', 'Sector B - Patio'),
(6, 'B-02', 'Camioneta', 'Disponible', 'Sector B - Patio'),
(7, 'B-03', 'Camioneta', 'Disponible', 'Sector B - Patio'),
(8, 'M-01', 'Motocicleta', 'Disponible', 'Bahía Motos'),
(9, 'M-02', 'Motocicleta', 'Disponible', 'Bahía Motos');

INSERT OR IGNORE INTO registros_acceso (id_acceso, placa, id_celda, fecha_hora_entrada, estado_acceso, operador_entrada) VALUES
(1, 'ABC123', 2, '2026-10-20T13:30:00.000Z', 'En Parqueadero', 'Porteria Principal');

INSERT OR IGNORE INTO novedades_vehiculo (id_novedad, id_acceso, momento_registro, tipo_novedad, descripcion, fecha_hora_registro) VALUES
(1, 1, 'Entrada', 'Carrocería', 'Presenta leve golpe en guardabarro trasero derecho.', '2026-10-20T13:30:00.000Z');
