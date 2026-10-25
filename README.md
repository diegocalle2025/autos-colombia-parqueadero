# Parqueadero Autos Colombia

Aplicacion web local para registrar entradas y salidas, consultar ocupacion e historial, y gestionar novedades de vehiculos.

## Requisitos

- Node.js 22.5 o posterior.

## Ejecutar

```bash
npm install
npm start
```

Luego abre `http://localhost:3000`. El servidor crea la base SQLite y aplica el esquema de `modelo_datos/03_modelo_fisico.sql` al iniciar. Para usar otra ubicacion, define `DATABASE_PATH` antes de ejecutar el servidor.

## Pruebas

```bash
npm test
```

El repo fuente conserva `src/`, el esquema SQL, las pruebas, `package.json` y `package-lock.json`. Los archivos del documento de entrega y otros artefactos se mantienen localmente y quedan excluidos de GitHub por `.gitignore`.
