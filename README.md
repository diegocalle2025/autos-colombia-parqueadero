# Parqueadero Autos Colombia

Aplicacion web local para registrar entradas y salidas, consultar ocupacion e historial, gestionar novedades de vehiculos y administrar el registro/consulta de usuarios y celdas (Iteracion 2).

## Requisitos

- Node.js 22.5 o posterior.

## Ejecutar

```bash
npm install
npm start
```

Luego abre `http://localhost:3000`. El servidor crea la base SQLite y aplica el esquema de `modelo_datos/03_modelo_fisico.sql` al iniciar. Para usar otra ubicacion, define `DATABASE_PATH` antes de ejecutar el servidor.

## Gestion de usuarios y celdas

La interfaz incluye formularios de registro y listas de consulta. La API expone:

- `GET /api/usuarios` y `POST /api/usuarios`
- `GET /api/celdas` y `POST /api/celdas`

Los registros aplican los valores iniciales y restricciones definidos en el esquema SQLite; los documentos y codigos duplicados se rechazan. Esta iteracion no incluye edicion/eliminacion funcional ni autenticacion/autorizacion tecnica por roles.

## Pruebas

```bash
npm test
```

El repo fuente conserva `src/`, el esquema SQL, las pruebas, `package.json` y `package-lock.json`. Los archivos del documento de entrega y otros artefactos se mantienen localmente y quedan excluidos de GitHub por `.gitignore`.
