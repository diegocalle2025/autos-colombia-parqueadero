# Autos Colombia - Sistema de Gestión de Parqueadero

Sistema de información integral para la administración operativa y financiera del parqueadero **"Autos Colombia"**, desarrollado bajo arquitectura cliente-servidor con Node.js, Express, SQLite y frontend web responsivo.

---

## Información Académica
- **Estudiante:** Juan Diego Calle Mazo
- **Programa Académico:** Tecnología en Desarrollo de Software
- **Asignatura:** Ingeniería de Software
- **Institución:** Institución Universitaria Digital de Antioquia (IU Digital)
- **Docente:** Esteban Montoya
- **Iteración:** 3 - Gestión Integral de Pagos y Mensualidades

---

## 📌 Historial de Iteraciones y Control de Cambios (Changelog)

Para atender puntualmente a las observaciones de retroalimentación docente, a continuación se detallan los módulos implementados a lo largo de las 3 fases del proyecto:

### 🔹 Iteración 1 (EA1): Control de Operación, Entradas y Salidas
- Registro de accesos de vehículos mediante validación de placa.
- Control de ocupación en tiempo real del patio de parqueo.
- Asignación dinámica de celdas según tipología vehicular (Automóvil, Camioneta, Motocicleta).
- Registro y consulta de novedades operativas (daños preexistentes, objetos de valor).
- Registro de salida con cálculo automático de tiempo de permanencia y liberación inmediata de celda.

### 🔹 Iteración 2 (EA2): Gestión de Usuarios y Celdas
- Módulo de administración de usuarios (clientes titulares / abonados) con validación de documento único.
- Módulo de gestión y parametrización de celdas físicas (código, tipología, estado y ubicación).
- Endpoints REST para consulta y registro de usuarios y celdas (`/api/usuarios`, `/api/celdas`).

### 🔹 Iteración 3 (EA3 - Entrega Actual): Gestión Integral de Pagos y Mensualidades
Esta entrega añade la capa contable, de recaudación, liquidación y auditoría financiera del sistema:

1. **Liquidación y Recaudo por Tipología de Vehículo:**
   - Parametrización y consulta automática de tarifas vigentes:
     - Automóvil: **$180.000 COP** / 30 días.
     - Camioneta: **$210.000 COP** / 30 días.
     - Motocicleta: **$90.000 COP** / 30 días.
   - Registro de transacciones con soporte para múltiples métodos de pago (Efectivo, Transferencia, Tarjeta).

2. **Gestión Atómica de Mensualidades y Recibos Digitales:**
   - Emisión automática de comprobante digital oficial con folio único consecutivo (`REC-XXXXXX`).
   - Cálculo atómico de periodos de vigencia de 30 días calendario:
     - Si la mensualidad está vigente, la nueva fecha final se extiende 30 días sobre la fecha de vencimiento actual.
     - Si la mensualidad está vencida o es nueva, la vigencia inicia desde la fecha del pago.
   - Modal interactivo con diseño formal de comprobante y función de impresión directa (`window.print()`).

3. **Historial de Pagos y Arqueo de Caja:**
   - Consulta centralizada de pagos con filtros multicriterio en tiempo real:
     - Por número de documento del titular.
     - Por placa del vehículo.
     - Por método de pago.
     - Por rango de fechas (desde / hasta).
   - Visualización de totales recaudados, operador responsable y estado de cada transacción.

4. **Monitoreo de Vencimientos y Próximos a Vencer:**
   - Tablero de control de mensualidades con clasificación por estados: `Vigente`, `Vencida` y `Cancelada`.
   - Filtro especializado para identificar mensualidades que vencen en los próximos **5 días**, permitiendo la gestión proactiva de cobro.

5. **Auditoría, Control de Acceso y Anulación Justificada:**
   - Diferenciación operativa de roles:
     - **Operador de Portería:** Registro de pagos en ventanilla y consulta de recibos.
     - **Administrador:** Acceso exclusivo para la anulación de pagos.
   - Flujo de anulación estricto: requiere justificación/motivo obligatorio y registro del administrador responsable.
   - Sincronización automática de estado: anular un pago revierte la mensualidad asociada a estado `Cancelada`.

6. **Integridad de Datos y Triggers de Seguridad en SQLite:**
   - `trg_no_borrar_pagos`: Impide la eliminación física (`DELETE`) de registros contables en la base de datos (inmutabilidad financiera).
   - `trg_anular_pago_sin_modificar_historial`: Garantiza que una vez confirmado un pago, solo pueda modificarse para anulación conservando la traza histórica.
   - `trg_validar_vigencia_mensualidad_insert` / `update`: Valida a nivel de base de datos que `fecha_fin >= fecha_inicio`.

---

## 📋 Trazabilidad con Historias de Usuario y Requerimientos

| Requerimiento | Historia de Usuario | Módulo / Endpoint Implementado | Componente UI |
|---|---|---|---|
| **RF-17** | **HU-12** | `POST /api/pagos` | Formulario de recaudo y liquidación |
| **RF-18** | **HU-13** | `GET /api/pagos/tarifa` | Consulta dinámica de tarifas sugeridas |
| **RF-19** | **HU-14** | `GET /api/pagos/:id` | Modal de Recibo Digital Oficial (`REC-XXXXXX`) |
| **RF-20** | **HU-15** | `GET /api/pagos` (filtros) | Historial y arqueo de caja con filtros |
| **RF-21** | **HU-16** | `GET /api/mensualidades?proximas=true` | Tablero de control y alerta de 5 días |
| **RF-22** | **HU-17** | `POST /api/pagos/:id/anular` | Modal de anulación justificada con rol Administrador |
| **RF-23** | **HU-18** | `modelo_datos/03_modelo_fisico.sql` | Triggers de inmutabilidad y auditoría SQL |

---

## 🛠️ Especificación de Endpoints REST (Iteración 3)

### 1. Pagos y Recaudos
- `GET /api/pagos/tarifa?placa={placa}`: Retorna la tarifa sugerida según el tipo de vehículo.
- `GET /api/pagos/vehiculos`: Lista vehículos activos con su titular para el selector de cobro.
- `POST /api/pagos`: Registra un pago atómico, actualiza o crea la mensualidad (30 días) y emite el recibo.
  - *Payload:* `{ placa, valor_pagado, metodo_pago, fecha_transaccion, operador, rol, observaciones }`
- `GET /api/pagos`: Consulta historial con filtros opcionales (`documento`, `placa`, `metodo`, `desde`, `hasta`).
- `GET /api/pagos/:id`: Retorna la información completa de un recibo individual por su ID o número de folio.
- `POST /api/pagos/:id/anular`: Anula un pago registrado y cancela la mensualidad asociada.
  - *Payload:* `{ rol: "Administrador", operador: "Nombre Admin", motivo: "Causa justificada..." }`
  - *Restricción:* Rechaza con código HTTP 403 si el rol no es Administrador o si falta el motivo.

### 2. Mensualidades y Vencimientos
- `GET /api/mensualidades`: Consulta mensualidades registradas con cálculo dinámico de días restantes.
  - *Filtros:* `estado` (Vigente / Vencida / Cancelada), `proximas=true` (vence en <= 5 días).

---

## 🚀 Requisitos y Puesta en Marcha

### Requisitos del Sistema
- **Node.js:** Versión 22.5.0 o superior (utiliza el módulo nativo `node:sqlite`).
- **NPM:** Gestor de paquetes incluido en Node.js.

### Pasos para Ejecución Local

1. **Clonar el repositorio:**
   ```bash
   git clone https://github.com/diegocalle2025/autos-colombia-parqueadero.git
   cd autos-colombia-parqueadero
   ```

2. **Instalar dependencias:**
   ```bash
   npm install
   ```

3. **Iniciar el servidor web:**
   ```bash
   npm start
   ```

4. **Acceder a la aplicación:**
   Abrir un navegador web e ingresar a:
   ```
   http://localhost:3000
   ```
   *Nota:* Al iniciar por primera vez, el servidor inicializa automáticamente la base de datos SQLite en `data/parqueadero.sqlite` con el esquema de datos y registros semilla dinámicos listos para operar.

---

## 🧪 Pruebas Automatizadas

El proyecto cuenta con una suite integral de pruebas unitarias y de integración desarrolladas con el ejecutor nativo `node --test`:

```bash
npm test
```

### Cobertura de Pruebas:
- **Suite 1:** Persistencia de datos, validación de placas, asignación y liberación de celdas, registro de novedades y verificación de reglas de acceso operativo (Iteraciones 1 y 2).
- **Suite 2:** Liquidación por tipología vehicular, ampliación de 30 días de vigencia, emisión de recibos `REC-XXXXXX`, filtros de arqueo, rechazo de anulación por operadores de portería, anulación autorizada por Administrador con justificación, inmutabilidad contable (triggers de base de datos) y filtro de mensualidades próximas a vencer (Iteración 3).

---

## 📁 Estructura del Repositorio

```text
├── modelo_datos/
│   └── 03_modelo_fisico.sql    # Esquema físico SQLite (tablas, llaves foráneas, triggers y seeds)
├── src/
│   ├── public/                 # Frontend Web SPA
│   │   ├── app.js              # Lógica cliente (eventos, consumo API REST, recibos digitales)
│   │   ├── index.html          # Vistas de Patio, Novedades, Usuarios, Celdas y Pagos
│   │   └── style.css           # Estilos visuales, badges, diseño de recibos y modo impresión
│   └── server.js               # Backend Node.js / Express con endpoints REST y lógica de negocio
├── test/
│   └── server.test.js          # Pruebas automatizadas de negocio e integración
├── package.json                # Configuración de dependencias y scripts de ejecución
├── README.md                   # Documentación general y registro de cambios
└── .gitignore                  # Exclusión de archivos locales, temporales y de entrega
```
