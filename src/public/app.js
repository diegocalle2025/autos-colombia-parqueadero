let estadoPatio = { estadisticas: {}, celdas: [], activos: [] };
let vehiculoValidado = null;
let accesoParaSalida = null;
let celdaPreseleccionada = null;

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, character => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  })[character]);
}

document.addEventListener('DOMContentLoaded', () => {
  iniciarReloj();
  cargarPatio();
  configurarAtajosTeclado();
  configurarGestion();
  setInterval(() => {
    if (!document.hidden && !document.querySelector('.modal-backdrop.open')) cargarPatio();
  }, 15000);
});

function iniciarReloj() {
  const el = document.getElementById('live-clock');
  const tick = () => {
    const ahora = new Date();
    el.textContent = ahora.toLocaleTimeString('es-CO', { hour12: false });
  };
  tick();
  setInterval(tick, 1000);
}

function configurarAtajosTeclado() {
  document.addEventListener('keydown', (e) => {
    if (e.key === 'F2') {
      e.preventDefault();
      abrirModalEntrada();
    } else if (e.key === 'Escape') {
      cerrarModalEntrada();
      cerrarModalSalida();
    }
  });

  const inpPlaca = document.getElementById('input-placa');
  if (inpPlaca) {
    inpPlaca.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        verificarPlaca();
      }
    });
  }
}

function irAlHome() {
  cambiarPestana('patio');
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function cambiarPestana(nombre) {
  document.querySelectorAll('.tab-btn').forEach(btn => btn.classList.remove('active'));
  document.querySelectorAll('.view-panel').forEach(panel => panel.classList.remove('active'));

  const btnActivo = document.getElementById(`tab-${nombre}-btn`);
  const panelActivo = document.getElementById(`vista-${nombre}`);
  if (btnActivo) btnActivo.classList.add('active');
  if (panelActivo) panelActivo.classList.add('active');

  if (nombre === 'patio') cargarPatio();
  if (nombre === 'mensualistas') cargarMensualistas();
  if (nombre === 'historial') cargarHistorial();
  if (nombre === 'usuarios') cargarUsuarios();
  if (nombre === 'celdas') cargarCeldas();
  if (nombre === 'pagos') {
    cargarVehiculosPagos();
    cargarPagos();
    cargarMensualidades();
  }
}

function configurarGestion() {
  const formUsuario = document.getElementById('form-usuario');
  if (formUsuario) formUsuario.addEventListener('submit', registrarUsuario);

  const formCelda = document.getElementById('form-celda');
  if (formCelda) formCelda.addEventListener('submit', registrarCelda);

  const formPago = document.getElementById('form-pago');
  if (formPago) formPago.addEventListener('submit', registrarPago);

  const selPlaca = document.getElementById('pago-placa');
  if (selPlaca) selPlaca.addEventListener('change', actualizarTarifaSugerida);

  const inpFechaPago = document.getElementById('pago-fecha');
  if (inpFechaPago && !inpFechaPago.value) {
    inpFechaPago.value = new Date().toISOString().slice(0, 10);
  }
}

function addEmptyRow(tbody, columnCount, message) {
  const row = document.createElement('tr');
  const cell = document.createElement('td');
  cell.colSpan = columnCount;
  cell.className = 'empty-state';
  cell.textContent = message;
  row.appendChild(cell);
  tbody.appendChild(row);
}

function addDataRow(tbody, values) {
  const row = document.createElement('tr');
  for (const value of values) {
    const cell = document.createElement('td');
    cell.textContent = value == null ? '' : String(value);
    row.appendChild(cell);
  }
  tbody.appendChild(row);
}

async function cargarUsuarios() {
  const tbody = document.getElementById('tbody-usuarios');
  tbody.replaceChildren();
  try {
    const response = await fetch('/api/usuarios');
    const users = await response.json();
    if (!response.ok) throw new Error(users.error || 'No fue posible consultar los usuarios.');
    if (users.length === 0) {
      addEmptyRow(tbody, 7, 'No hay usuarios registrados.');
      return;
    }
    users.forEach(user => addDataRow(tbody, [
      user.documento,
      user.nombres,
      user.apellidos,
      user.telefono,
      user.correo,
      new Date(user.fecha_registro).toLocaleString('es-CO'),
      user.estado
    ]));
  } catch (error) {
    addEmptyRow(tbody, 7, 'No fue posible cargar los usuarios.');
    mostrarToast(error.message || 'Error al cargar usuarios.');
  }
}

async function registrarUsuario(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const message = document.getElementById('usuario-mensaje');
  const submitButton = form.querySelector('button[type="submit"]');
  const user = Object.fromEntries(new FormData(form).entries());
  message.textContent = '';
  submitButton.disabled = true;
  try {
    const response = await fetch('/api/usuarios', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(user)
    });
    const result = await response.json();
    if (!response.ok) {
      message.textContent = result.error || 'No fue posible registrar el usuario.';
      message.classList.add('error');
      return;
    }
    form.reset();
    message.textContent = result.mensaje;
    message.classList.remove('error');
    await cargarUsuarios();
  } catch (error) {
    message.textContent = 'No fue posible comunicarse con el servidor.';
    message.classList.add('error');
    mostrarToast(error.message || 'Error al registrar usuario.');
  } finally {
    submitButton.disabled = false;
  }
}

async function cargarCeldas() {
  const tbody = document.getElementById('tbody-celdas');
  tbody.replaceChildren();
  try {
    const response = await fetch('/api/celdas');
    const cells = await response.json();
    if (!response.ok) throw new Error(cells.error || 'No fue posible consultar las celdas.');
    if (cells.length === 0) {
      addEmptyRow(tbody, 4, 'No hay celdas registradas.');
      return;
    }
    cells.forEach(cell => addDataRow(tbody, [
      cell.codigo,
      cell.tipo,
      cell.estado,
      cell.ubicacion
    ]));
  } catch (error) {
    addEmptyRow(tbody, 4, 'No fue posible cargar las celdas.');
    mostrarToast(error.message || 'Error al cargar celdas.');
  }
}

async function registrarCelda(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const message = document.getElementById('celda-mensaje');
  const submitButton = form.querySelector('button[type="submit"]');
  const cell = Object.fromEntries(new FormData(form).entries());
  message.textContent = '';
  submitButton.disabled = true;
  try {
    const response = await fetch('/api/celdas', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(cell)
    });
    const result = await response.json();
    if (!response.ok) {
      message.textContent = result.error || 'No fue posible registrar la celda.';
      message.classList.add('error');
      return;
    }
    form.reset();
    message.textContent = result.mensaje;
    message.classList.remove('error');
    await cargarCeldas();
    await cargarPatio();
  } catch (error) {
    message.textContent = 'No fue posible comunicarse con el servidor.';
    message.classList.add('error');
    mostrarToast(error.message || 'Error al registrar celda.');
  } finally {
    submitButton.disabled = false;
  }
}

async function cargarPatio() {
  try {
    const res = await fetch('/api/patio');
    const data = await res.json();
    estadoPatio = data;
    actualizarIndicadores(data.estadisticas);
    renderizarCeldas(data.celdas, data.activos);
    renderizarTablaActivos(data.activos);
  } catch (err) {
    mostrarToast('Error al conectar con el servidor');
  }
}

function actualizarIndicadores(stats) {
  document.getElementById('stat-total').textContent = stats.totalCeldas || 0;
  document.getElementById('stat-libres').textContent = stats.celdasDisponibles || 0;
  document.getElementById('stat-ocupadas').textContent = stats.celdasOcupadas || 0;
}

function renderizarCeldas(celdas, activos) {
  const contenedor = document.getElementById('grid-celdas');
  contenedor.replaceChildren();

  celdas.forEach(cel => {
    const ocupante = activos.find(a => a.id_celda === cel.id_celda);
    const item = document.createElement('div');
    item.className = `cell-item ${cel.estado.toLowerCase()}`;
    if (ocupante) {
      item.onclick = () => abrirModalSalida(ocupante.id_acceso);
    } else {
      item.onclick = () => abrirModalEntradaConCelda(cel.id_celda);
    }

    const details = document.createElement('div');
    const code = document.createElement('div');
    code.className = 'cell-code';
    code.textContent = cel.codigo;
    const type = document.createElement('div');
    type.className = 'cell-type';
    type.textContent = `${cel.tipo} • ${cel.sector}`;
    details.append(code, type);

    const status = document.createElement('div');
    if (ocupante) {
      const plate = document.createElement('span');
      plate.className = 'cell-plate';
      plate.textContent = ocupante.placa;
      status.appendChild(plate);
    }
    const statusText = document.createElement('div');
    statusText.className = 'cell-status-text';
    statusText.textContent = cel.estado;
    status.appendChild(statusText);
    item.append(details, status);
    contenedor.appendChild(item);
  });
}

function renderizarTablaActivos(activos) {
  const tbody = document.getElementById('tbody-activos');
  tbody.innerHTML = '';

  if (!activos || activos.length === 0) {
    tbody.innerHTML = `<tr><td colspan="8" style="text-align: center; color: var(--text-dim); padding: 2rem;">No hay vehiculos en el parqueadero actualmente.</td></tr>`;
    return;
  }

  activos.forEach(a => {
    const entradaDate = new Date(a.fecha_hora_entrada);
    const tiempoEstadia = calcularTiempoLegible(entradaDate);

    let novedadesHtml = '<span style="color: var(--text-dim); font-size: 0.8rem;">Sin reporte</span>';
    if (a.novedades && a.novedades.length > 0) {
      novedadesHtml = a.novedades.map(n => `<span class="badge badge-novedad" title="${escapeHtml(n.descripcion)}">${escapeHtml(n.tipo)}</span>`).join(' ');
    }

    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td><span class="plate-badge">${escapeHtml(a.placa)}</span></td>
      <td><strong>${escapeHtml(a.cliente)}</strong><br><small style="color: var(--text-muted);">${escapeHtml(a.telefono)}</small></td>
      <td>${escapeHtml(a.tipo)} - ${escapeHtml(a.marca)}</td>
      <td><strong style="font-family: 'Space Mono';">${escapeHtml(a.codigo_celda)}</strong></td>
      <td>${entradaDate.toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit' })}</td>
      <td>${tiempoEstadia}</td>
      <td>${novedadesHtml}</td>
      <td>
        <button class="btn-danger" onclick="abrirModalSalida(${a.id_acceso})">Salida</button>
      </td>
    `;
    tbody.appendChild(tr);
  });
}

function calcularTiempoLegible(fechaInicio) {
  const ahora = new Date();
  const diffMs = ahora - fechaInicio;
  const minutos = Math.max(1, Math.floor(diffMs / (1000 * 60)));
  const horas = Math.floor(minutos / 60);
  const minRest = minutos % 60;
  if (horas > 0) {
    return `${horas}h ${minRest}m`;
  }
  return `${minutos}m`;
}

function filtrarActivos() {
  const q = document.getElementById('filtro-placa').value.toLowerCase().trim();
  const filtrados = estadoPatio.activos.filter(a =>
    a.placa.toLowerCase().includes(q) ||
    a.cliente.toLowerCase().includes(q) ||
    a.codigo_celda.toLowerCase().includes(q)
  );
  renderizarTablaActivos(filtrados);
}

function abrirModalEntrada(idCelda = null) {
  vehiculoValidado = null;
  celdaPreseleccionada = idCelda;
  document.getElementById('input-placa').value = '';
  document.getElementById('card-resultado-validacion').className = 'validation-box hidden';
  document.getElementById('card-resultado-validacion').innerHTML = '';
  document.getElementById('select-celda').innerHTML = '<option value="">Valide una placa primero...</option>';
  document.getElementById('select-celda').disabled = true;
  document.getElementById('check-novedad').checked = false;
  document.getElementById('caja-novedad').classList.add('hidden');
  document.getElementById('text-desc-novedad').value = '';
  document.getElementById('btn-confirmar-entrada').disabled = true;

  document.getElementById('modal-entrada').classList.add('open');
  setTimeout(() => document.getElementById('input-placa').focus(), 100);
}

function abrirModalEntradaConCelda(idCelda) {
  abrirModalEntrada(idCelda);
}

function cerrarModalEntrada() {
  document.getElementById('modal-entrada').classList.remove('open');
}

async function verificarPlaca() {
  const placa = document.getElementById('input-placa').value.trim();
  const box = document.getElementById('card-resultado-validacion');
  const btn = document.getElementById('btn-confirmar-entrada');
  const selCelda = document.getElementById('select-celda');

  if (!placa) {
    mostrarToast('Por favor ingrese una placa vehicular');
    return;
  }

  box.classList.remove('hidden', 'valido', 'error');

  try {
    const res = await fetch('/api/validar-placa', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ placa })
    });
    const data = await res.json();

    if (!res.ok) {
      box.classList.add('error');
      box.innerHTML = `
        <div class="val-title">${escapeHtml(data.mensaje || 'Validacion denegada')}</div>
        <div class="val-detail">No se puede autorizar el ingreso bajo modalidad de mensualidad.</div>
      `;
      btn.disabled = true;
      selCelda.disabled = true;
      selCelda.innerHTML = '<option value="">Sin autorizacion</option>';
      return;
    }

    vehiculoValidado = data;
    box.classList.add('valido');
    box.innerHTML = `
      <div class="val-title">Mensualidad Activa: ${escapeHtml(data.usuario.nombres)}</div>
      <div class="val-detail">
        Vehiculo: <strong>${escapeHtml(data.vehiculo.tipo)} ${escapeHtml(data.vehiculo.marca)} ${escapeHtml(data.vehiculo.modelo)}</strong> (${escapeHtml(data.vehiculo.color)})<br>
        Vigencia plan: <strong>${escapeHtml(data.mensualidad.fecha_inicio)} al ${escapeHtml(data.mensualidad.fecha_fin)}</strong>
      </div>
    `;

    selCelda.disabled = false;
    selCelda.replaceChildren();
    if (data.celdasDisponibles.length === 0) {
      const option = document.createElement('option');
      option.value = '';
      option.textContent = `No hay celdas disponibles para ${data.vehiculo.tipo}`;
      selCelda.appendChild(option);
      btn.disabled = true;
    } else {
      data.celdasDisponibles.forEach(c => {
        const option = document.createElement('option');
        option.value = String(c.id_celda);
        option.textContent = `Celda ${c.codigo} (${c.sector})`;
        selCelda.appendChild(option);
      });
      if (data.celdasDisponibles.some(c => c.id_celda === celdaPreseleccionada)) {
        selCelda.value = String(celdaPreseleccionada);
      }
      btn.disabled = false;
    }

  } catch (err) {
    box.classList.add('error');
    box.textContent = 'Error al comunicarse con el servidor';
    btn.disabled = true;
  }
}

function toggleSeccionNovedad() {
  const checked = document.getElementById('check-novedad').checked;
  const caja = document.getElementById('caja-novedad');
  if (checked) {
    caja.classList.remove('hidden');
  } else {
    caja.classList.add('hidden');
  }
}

async function guardarEntrada() {
  if (!vehiculoValidado) return;
  const placa = document.getElementById('input-placa').value.trim();
  const id_celda = document.getElementById('select-celda').value;
  const tieneNovedad = document.getElementById('check-novedad').checked;
  const tipo_novedad = document.getElementById('select-tipo-novedad').value;
  const novedad = tieneNovedad ? document.getElementById('text-desc-novedad').value : '';

  if (!id_celda) {
    mostrarToast('Seleccione una celda');
    return;
  }
  if (tieneNovedad && !novedad.trim()) {
    mostrarToast('Describa la novedad registrada');
    return;
  }
  const ticketWindow = window.open('', '_blank', 'width=420,height=640');

  try {
    const res = await fetch('/api/entrada', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        placa,
        id_celda,
        registrar_novedad: tieneNovedad,
        novedad,
        tipo_novedad,
        operador: 'Porteria Principal'
      })
    });
    const data = await res.json();

    if (!res.ok) {
      if (ticketWindow) ticketWindow.close();
      mostrarToast(data.error || 'Error al registrar entrada');
      return;
    }

    if (ticketWindow && data.ticket) imprimirTicket(ticketWindow, data.ticket);
    cerrarModalEntrada();
    mostrarToast(`Ingreso registrado: ${placa} asignado a celda ${data.celda}`);
    cargarPatio();
  } catch (err) {
    if (ticketWindow) ticketWindow.close();
    mostrarToast('Fallo la comunicacion con el servidor');
  }
}

function imprimirTicket(ticketWindow, ticket) {
  const safe = value => String(value ?? '').replace(/[&<>"']/g, char => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  })[char]);
  const fecha = new Date(ticket.fecha_hora).toLocaleString('es-CO');
  const novedades = ticket.novedades?.length
    ? ticket.novedades.map(item => `<li>${safe(item.tipo)}: ${safe(item.descripcion)}</li>`).join('')
    : '<li>Sin novedades reportadas</li>';
  ticketWindow.document.open();
  ticketWindow.document.write(`<!doctype html><html lang="es"><head><meta charset="utf-8"><title>Ticket #${safe(ticket.folio)}</title><style>body{font:15px Arial,sans-serif;color:#17212b;max-width:360px;margin:32px auto;padding:20px;border:1px dashed #596773}h1{text-align:center;font-size:20px}h2{text-align:center;font-size:15px;font-weight:400}.folio{font-size:24px;font-weight:700;text-align:center;margin:24px 0}.row{display:flex;justify-content:space-between;gap:16px;padding:8px 0;border-bottom:1px solid #d9e0e6}.notice{margin-top:22px;text-align:center;font-size:12px}@media print{body{margin:0;border:0}}</style></head><body><h1>AUTOS COLOMBIA</h1><h2>Comprobante de ingreso</h2><div class="folio">Folio #${safe(ticket.folio)}</div><div class="row"><span>Placa</span><strong>${safe(ticket.placa)}</strong></div><div class="row"><span>Vehiculo</span><strong>${safe(ticket.tipo)} ${safe(ticket.marca)} ${safe(ticket.modelo)}</strong></div><div class="row"><span>Cliente</span><strong>${safe(ticket.cliente)}</strong></div><div class="row"><span>Celda</span><strong>${safe(ticket.celda)}</strong></div><div class="row"><span>Ingreso</span><strong>${safe(fecha)}</strong></div><div class="row"><span>Operador</span><strong>${safe(ticket.operador)}</strong></div><h3>Novedades</h3><ul>${novedades}</ul><p class="notice">Conserve este comprobante para cualquier consulta.</p><script>window.addEventListener('load',()=>window.print())<\\/script></body></html>`);
  ticketWindow.document.close();
}

function abrirModalSalida(idAcceso) {
  const activo = estadoPatio.activos.find(a => a.id_acceso === idAcceso);
  if (!activo) return;

  accesoParaSalida = activo;
  const cont = document.getElementById('salida-detalles');
  const entradaDate = new Date(activo.fecha_hora_entrada);
  const estadiaEstimada = calcularTiempoLegible(entradaDate);

  let novedadesPrevias = '<p style="color: var(--text-dim); font-size: 0.85rem;">Ninguna observacion fisica registrada al ingreso.</p>';
  if (activo.novedades && activo.novedades.length > 0) {
    novedadesPrevias = activo.novedades.map(n => `<div style="font-size: 0.85rem; margin-top: 0.3rem;"><strong style="color: var(--accent-amber);">${escapeHtml(n.tipo)}:</strong> ${escapeHtml(n.descripcion)}</div>`).join('');
  }

  cont.innerHTML = `
    <div class="summary-card">
      <div class="summary-row">
        <span>Vehiculo:</span>
        <strong>${escapeHtml(activo.placa)} (${escapeHtml(activo.tipo)} ${escapeHtml(activo.marca)})</strong>
      </div>
      <div class="summary-row">
        <span>Cliente Abonado:</span>
        <strong>${escapeHtml(activo.cliente)}</strong>
      </div>
      <div class="summary-row">
        <span>Celda Actual:</span>
        <strong style="color: var(--accent-amber);">${escapeHtml(activo.codigo_celda)}</strong>
      </div>
      <div class="summary-row">
        <span>Hora de Ingreso:</span>
        <span>${entradaDate.toLocaleTimeString('es-CO')}</span>
      </div>
      <div class="summary-row">
        <span>Tiempo de Permanencia:</span>
        <strong style="color: var(--status-available);">${estadiaEstimada}</strong>
      </div>
    </div>

    <div style="margin-bottom: 1rem;">
      <label style="font-size: 0.82rem; font-weight: 700; color: var(--text-muted); text-transform: uppercase;">Estado registrado al entrar:</label>
      <div style="background: var(--bg-deep); padding: 0.8rem; border-radius: var(--radius-sm); border: 1px solid var(--border-subtle); margin-top: 0.3rem;">
        ${novedadesPrevias}
      </div>
    </div>

    <div class="form-group">
      <label for="text-salida-novedad">Observacion o Novedad de Salida (Opcional):</label>
      <input type="text" id="text-salida-novedad" class="form-control" placeholder="Vehiculo entregado a satisfaccion sin incidentes">
    </div>

    <div style="font-size: 0.82rem; color: var(--status-available);">
      Al confirmar, la celda <strong>${escapeHtml(activo.codigo_celda)}</strong> quedara inmediatamente DISPONIBLE.
    </div>
  `;

  document.getElementById('modal-salida').classList.add('open');
}

function cerrarModalSalida() {
  document.getElementById('modal-salida').classList.remove('open');
  accesoParaSalida = null;
}

async function guardarSalida() {
  if (!accesoParaSalida) return;
  const id_acceso = accesoParaSalida.id_acceso;
  const novedad_salida = document.getElementById('text-salida-novedad').value;

  try {
    const res = await fetch('/api/salida', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id_acceso,
        novedad_salida,
        operador: 'Porteria Principal'
      })
    });
    const data = await res.json();

    if (!res.ok) {
      mostrarToast(data.error || 'Error al tramitar la salida');
      return;
    }

    cerrarModalSalida();
    mostrarToast(`Salida confirmada: Celda ${data.celdaLiberada} liberada`);
    cargarPatio();
  } catch (err) {
    mostrarToast('Fallo al procesar salida con el servidor');
  }
}

async function cargarMensualistas() {
  try {
    const res = await fetch('/api/mensualistas');
    const data = await res.json();
    const tbody = document.getElementById('tbody-mensualistas');
    tbody.innerHTML = '';

    data.forEach(m => {
      const badgeClase = m.estadoMensualidad === 'Vigente' ? 'badge-vigente' : 'badge-vencida';
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td><span class="plate-badge">${escapeHtml(m.placa)}</span></td>
        <td><strong>${escapeHtml(m.cliente)}</strong></td>
        <td>${escapeHtml(m.documento)}</td>
        <td>${escapeHtml(m.telefono)}</td>
        <td>${escapeHtml(m.tipo)} - ${escapeHtml(m.marca)} ${escapeHtml(m.modelo)} (${escapeHtml(m.color)})</td>
        <td><span class="badge ${badgeClase}">${escapeHtml(m.estadoMensualidad)}</span></td>
        <td>${escapeHtml(m.fechaFin)}</td>
      `;
      tbody.appendChild(tr);
    });
  } catch (err) {
    mostrarToast('Error al cargar abonados');
  }
}

async function cargarHistorial() {
  try {
    const params = new URLSearchParams();
    const placa = document.getElementById('historial-placa').value.trim();
    const desde = document.getElementById('historial-desde').value;
    const hasta = document.getElementById('historial-hasta').value;
    if (placa) params.set('placa', placa);
    if (desde) params.set('desde', desde);
    if (hasta) params.set('hasta', hasta);
    const query = params.toString();
    const res = await fetch(`/api/historico${query ? `?${query}` : ''}`);
    const data = await res.json();
    const tbody = document.getElementById('tbody-historial');
    tbody.innerHTML = '';

    if (data.length === 0) {
      tbody.innerHTML = `<tr><td colspan="9" style="text-align: center; color: var(--text-dim); padding: 2rem;">No hay registros de movimientos en el historial.</td></tr>`;
      return;
    }

    data.forEach(h => {
      const fechaEnt = new Date(h.entrada).toLocaleString('es-CO');
      const fechaSal = h.salida ? new Date(h.salida).toLocaleString('es-CO') : '<span style="color: var(--accent-amber);">En Parqueadero</span>';
      const mins = h.minutos ? `${h.minutos} min` : '-';
      const novs = h.novedades && h.novedades.length > 0
        ? h.novedades.map(n => `[${n.momento}] ${n.tipo}: ${n.descripcion}`).join(' | ')
        : 'Sin novedad';

      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td>#${h.id_acceso}</td>
        <td><span class="plate-badge">${escapeHtml(h.placa)}</span></td>
        <td>${escapeHtml(h.cliente)}</td>
        <td><strong style="font-family: 'Space Mono';">${escapeHtml(h.celda)}</strong></td>
        <td>${escapeHtml(h.operador)}</td>
        <td>${fechaEnt}</td>
        <td>${fechaSal}</td>
        <td>${mins}</td>
        <td style="font-size: 0.8rem; color: var(--text-muted);">${escapeHtml(novs)}</td>
      `;
      tbody.appendChild(tr);
    });
  } catch (err) {
    mostrarToast('Error al cargar historial');
  }
}

function limpiarFiltroHistorial() {
  document.getElementById('historial-placa').value = '';
  document.getElementById('historial-desde').value = '';
  document.getElementById('historial-hasta').value = '';
  cargarHistorial();
}

function mostrarToast(mensaje) {
  const toast = document.getElementById('toast');
  toast.textContent = mensaje;
  toast.classList.add('show');
  setTimeout(() => {
    toast.classList.remove('show');
  }, 3500);
}

/* ==========================================================================
   ITERACIÓN 3: GESTIÓN INTEGRAL DE PAGOS Y MENSUALIDADES
   ========================================================================== */

let vehiculosPagosCache = [];

async function cargarVehiculosPagos() {
  const sel = document.getElementById('pago-placa');
  if (!sel) return;
  try {
    const res = await fetch('/api/pagos/vehiculos');
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'No fue posible cargar vehículos.');
    vehiculosPagosCache = data;
    sel.innerHTML = '';
    if (data.length === 0) {
      sel.innerHTML = '<option value="">No hay vehículos registrados</option>';
      return;
    }
    sel.innerHTML = '<option value="">-- Seleccione un vehículo --</option>' +
      data.map(v => `<option value="${escapeHtml(v.placa)}">${escapeHtml(v.placa)} - ${escapeHtml(v.titular)} (${escapeHtml(v.tipo)} ${escapeHtml(v.marca || '')})</option>`).join('');
    
    if (sel.value) {
      await actualizarTarifaSugerida();
    }
  } catch (err) {
    sel.innerHTML = '<option value="">Error al cargar vehículos</option>';
    mostrarToast(err.message || 'Error al cargar lista de vehículos');
  }
}

async function actualizarTarifaSugerida() {
  const selPlaca = document.getElementById('pago-placa');
  const inputValor = document.getElementById('pago-valor');
  if (!selPlaca || !inputValor) return;
  const placa = selPlaca.value;
  if (!placa) {
    inputValor.value = '';
    return;
  }
  try {
    const res = await fetch(`/api/pagos/tarifa?placa=${encodeURIComponent(placa)}`);
    const data = await res.json();
    if (res.ok && data.tarifa) {
      inputValor.value = data.tarifa;
    }
  } catch (err) {
    console.error('No fue posible consultar tarifa:', err);
  }
}

async function registrarPago(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const submitBtn = form.querySelector('button[type="submit"]');
  const msgEl = document.getElementById('pago-mensaje');
  msgEl.textContent = '';
  msgEl.className = 'form-message';

  const formData = new FormData(form);
  const payload = Object.fromEntries(formData.entries());

  if (!payload.placa) {
    msgEl.textContent = 'Debe seleccionar un vehículo.';
    msgEl.classList.add('error');
    return;
  }
  if (!payload.valor_pagado || Number(payload.valor_pagado) <= 0) {
    msgEl.textContent = 'El valor pagado debe ser mayor a cero.';
    msgEl.classList.add('error');
    return;
  }
  if (!payload.metodo_pago) {
    msgEl.textContent = 'Seleccione un método de pago válido.';
    msgEl.classList.add('error');
    return;
  }
  if (!payload.fecha_transaccion) {
    msgEl.textContent = 'Indique la fecha de transacción.';
    msgEl.classList.add('error');
    return;
  }

  submitBtn.disabled = true;
  try {
    const res = await fetch('/api/pagos', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const result = await res.json();
    if (!res.ok) {
      msgEl.textContent = result.error || 'No fue posible registrar el pago.';
      msgEl.classList.add('error');
      mostrarToast(result.error || 'Error al registrar pago');
      return;
    }

    msgEl.textContent = `Pago registrado exitosamente. Recibo: ${result.pago.numero_recibo}`;
    msgEl.classList.remove('error');
    mostrarToast(`Pago registrado con éxito (Folio: ${result.pago.numero_recibo})`);

    form.reset();
    const inpFecha = document.getElementById('pago-fecha');
    if (inpFecha) inpFecha.value = new Date().toISOString().slice(0, 10);

    await Promise.all([
      cargarPagos(),
      cargarMensualidades(),
      cargarMensualistas()
    ]);

    mostrarReciboPago(result.pago);
  } catch (err) {
    msgEl.textContent = 'Error de comunicación con el servidor.';
    msgEl.classList.add('error');
    mostrarToast('Error de red al procesar el pago.');
  } finally {
    submitBtn.disabled = false;
  }
}

function mostrarReciboPago(pago) {
  const modal = document.getElementById('modal-recibo-pago');
  const contenedor = document.getElementById('recibo-detalles');
  if (!modal || !contenedor) return;

  const fechaTx = pago.fecha_pago ? new Date(pago.fecha_pago).toLocaleString('es-CO') : new Date().toLocaleString('es-CO');
  const valorFormateado = Number(pago.valor_pagado).toLocaleString('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 });
  const badgeClase = pago.estado === 'Confirmado' ? 'badge-confirmado' : 'badge-anulado';

  contenedor.innerHTML = `
    <div class="receipt-box" id="printable-receipt">
      <div class="receipt-header">
        <h4 style="margin: 0; font-size: 1.2rem; font-weight: 700; color: var(--accent-blue);">PARQUEADERO AUTOS COLOMBIA</h4>
        <p style="margin: 0.2rem 0; font-size: 0.85rem; color: var(--text-dim);">NIT: 900.123.456-7 &bull; Régimen Común</p>
        <p style="margin: 0.1rem 0; font-size: 0.8rem; color: var(--text-dim);">Calle 50 # 45-20, Medellín &bull; Tel: (604) 444-5566</p>
        <div style="margin-top: 0.8rem; padding: 0.4rem; background: var(--bg-card-alt); border-radius: 6px; border: 1px dashed var(--border-color);">
          <strong style="font-size: 1.05rem; letter-spacing: 1px;">RECIBO OFICIAL N° ${escapeHtml(pago.numero_recibo)}</strong>
        </div>
      </div>

      <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 0.8rem; margin: 1rem 0; font-size: 0.88rem;">
        <div>
          <span style="color: var(--text-dim); display: block; font-size: 0.78rem;">Fecha y Hora:</span>
          <strong>${fechaTx}</strong>
        </div>
        <div>
          <span style="color: var(--text-dim); display: block; font-size: 0.78rem;">Estado del Pago:</span>
          <span class="badge ${badgeClase}">${escapeHtml(pago.estado)}</span>
        </div>
        <div>
          <span style="color: var(--text-dim); display: block; font-size: 0.78rem;">Titular / Cliente:</span>
          <strong>${escapeHtml(pago.usuario_nombre || 'N/A')}</strong>
        </div>
        <div>
          <span style="color: var(--text-dim); display: block; font-size: 0.78rem;">Documento / NIT:</span>
          <span>${escapeHtml(pago.documento_usuario || 'N/A')}</span>
        </div>
        <div>
          <span style="color: var(--text-dim); display: block; font-size: 0.78rem;">Vehículo amparado:</span>
          <span class="plate-badge">${escapeHtml(pago.placa)}</span> (${escapeHtml(pago.tipo_vehiculo || 'Vehículo')})
        </div>
        <div>
          <span style="color: var(--text-dim); display: block; font-size: 0.78rem;">Método de Pago:</span>
          <strong>${escapeHtml(pago.metodo_pago)}</strong>
        </div>
      </div>

      <table class="receipt-table" style="width: 100%; border-collapse: collapse; margin: 1rem 0; font-size: 0.88rem;">
        <thead>
          <tr style="border-bottom: 2px solid var(--border-color); text-align: left;">
            <th style="padding: 0.4rem 0;">Concepto</th>
            <th style="padding: 0.4rem 0; text-align: center;">Periodo Amparado</th>
            <th style="padding: 0.4rem 0; text-align: right;">Total COP</th>
          </tr>
        </thead>
        <tbody>
          <tr style="border-bottom: 1px solid var(--border-color);">
            <td style="padding: 0.6rem 0;">Mensualidad Servicio de Parqueadero (30 días)</td>
            <td style="padding: 0.6rem 0; text-align: center; font-size: 0.82rem;">${escapeHtml(pago.fecha_inicio)} al ${escapeHtml(pago.fecha_fin)}</td>
            <td style="padding: 0.6rem 0; text-align: right; font-weight: 600;">${valorFormateado}</td>
          </tr>
        </tbody>
        <tfoot>
          <tr>
            <th colspan="2" style="padding: 0.8rem 0; text-align: right; font-size: 1rem;">TOTAL CANCELADO:</th>
            <th style="padding: 0.8rem 0; text-align: right; font-size: 1.15rem; color: var(--accent-emerald);">${valorFormateado}</th>
          </tr>
        </tfoot>
      </table>

      ${pago.estado === 'Anulado' ? `
        <div style="background: rgba(239, 68, 68, 0.1); border-left: 4px solid var(--status-occupied); padding: 0.6rem; margin: 0.8rem 0; border-radius: 4px; font-size: 0.85rem;">
          <strong style="color: var(--status-occupied); display: block;">&#9888; REGISTRO ANULADO</strong>
          <div><strong>Motivo:</strong> ${escapeHtml(pago.motivo_anulacion || 'Sin motivo')}</div>
          <div><strong>Anulado por:</strong> ${escapeHtml(pago.anulado_por || 'Administrador')} el ${escapeHtml(pago.fecha_anulacion || '')}</div>
        </div>
      ` : ''}

      <div style="font-size: 0.78rem; color: var(--text-dim); margin-top: 1rem; border-top: 1px dashed var(--border-color); padding-top: 0.6rem; text-align: center;">
        <p style="margin: 0.2rem 0;">Operador emisor: <strong>${escapeHtml(pago.operador)}</strong></p>
        <p style="margin: 0.2rem 0;">Este documento constituye comprobante válido de pago de mensualidad.</p>
        <p style="margin: 0.2rem 0;">¡Gracias por confiar en Autos Colombia!</p>
      </div>
    </div>
  `;

  modal.classList.add('open');
}

function cerrarModalRecibo() {
  const modal = document.getElementById('modal-recibo-pago');
  if (modal) modal.classList.remove('open');
}

function imprimirRecibo() {
  window.print();
}

async function cargarPagos() {
  const tbody = document.getElementById('tbody-pagos');
  if (!tbody) return;
  tbody.replaceChildren();

  const documento = document.getElementById('filtro-pago-documento')?.value.trim() || '';
  const placa = document.getElementById('filtro-pago-placa')?.value.trim() || '';
  const metodo = document.getElementById('filtro-pago-metodo')?.value || '';
  const desde = document.getElementById('filtro-pago-desde')?.value || '';
  const hasta = document.getElementById('filtro-pago-hasta')?.value || '';

  const params = new URLSearchParams();
  if (documento) params.set('documento', documento);
  if (placa) params.set('placa', placa);
  if (metodo) params.set('metodo', metodo);
  if (desde) params.set('desde', desde);
  if (hasta) params.set('hasta', hasta);

  try {
    const res = await fetch(`/api/pagos?${params.toString()}`);
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'No fue posible consultar pagos.');

    if (data.length === 0) {
      addEmptyRow(tbody, 10, 'No se encontraron pagos con los criterios seleccionados.');
      return;
    }

    data.forEach(p => {
      const fechaTx = p.fecha_pago ? new Date(p.fecha_pago).toLocaleString('es-CO') : '-';
      const valorFmt = Number(p.valor_pagado).toLocaleString('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 });
      const badgeClase = p.estado === 'Confirmado' ? 'badge-confirmado' : 'badge-anulado';

      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td><strong style="font-family: 'Space Mono', monospace; font-size: 0.88rem;">${escapeHtml(p.numero_recibo)}</strong></td>
        <td style="font-size: 0.84rem;">${fechaTx}</td>
        <td><strong>${escapeHtml(p.usuario_nombre || 'N/A')}</strong><br><span style="font-size: 0.78rem; color: var(--text-dim);">${escapeHtml(p.documento_usuario || '')}</span></td>
        <td><span class="plate-badge">${escapeHtml(p.placa)}</span><br><span style="font-size: 0.78rem; color: var(--text-dim);">${escapeHtml(p.tipo_vehiculo || '')}</span></td>
        <td style="font-weight: 600; color: var(--accent-emerald);">${valorFmt}</td>
        <td>${escapeHtml(p.metodo_pago)}</td>
        <td><span class="badge ${badgeClase}">${escapeHtml(p.estado)}</span></td>
        <td style="font-size: 0.82rem;">${escapeHtml(p.fecha_inicio)} al ${escapeHtml(p.fecha_fin)}</td>
        <td style="font-size: 0.82rem;">${escapeHtml(p.operador)}</td>
        <td>
          <div style="display: flex; gap: 0.3rem;">
            <button class="btn-sm btn-secondary" title="Ver e Imprimir Comprobante" onclick="verReciboPorId(${p.id_pago})">&#128196; Recibo</button>
            ${p.estado === 'Confirmado' ? `
              <button class="btn-sm btn-danger" title="Anular Pago (Solo Administrador)" onclick="abrirModalAnularPago(${p.id_pago}, '${escapeHtml(p.numero_recibo)}')">&#10006; Anular</button>
            ` : `
              <span class="badge badge-anulado" title="Motivo: ${escapeHtml(p.motivo_anulacion || '')}">Anulado</span>
            `}
          </div>
        </td>
      `;
      tbody.appendChild(tr);
    });
  } catch (err) {
    addEmptyRow(tbody, 10, 'No fue posible cargar el historial de pagos.');
    mostrarToast(err.message || 'Error al cargar pagos');
  }
}

async function verReciboPorId(idPago) {
  try {
    const res = await fetch(`/api/pagos/${idPago}`);
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'No se encontró el recibo.');
    mostrarReciboPago(data);
  } catch (err) {
    mostrarToast(err.message || 'Error al consultar recibo');
  }
}

function limpiarFiltrosPagos() {
  const doc = document.getElementById('filtro-pago-documento');
  const pla = document.getElementById('filtro-pago-placa');
  const met = document.getElementById('filtro-pago-metodo');
  const des = document.getElementById('filtro-pago-desde');
  const has = document.getElementById('filtro-pago-hasta');
  if (doc) doc.value = '';
  if (pla) pla.value = '';
  if (met) met.value = '';
  if (des) des.value = '';
  if (has) has.value = '';
  cargarPagos();
}

function abrirModalAnularPago(idPago, folio) {
  const modal = document.getElementById('modal-anular-pago');
  if (!modal) return;
  document.getElementById('anular-pago-id').value = idPago;
  document.getElementById('anular-pago-folio').value = folio;
  document.getElementById('anular-pago-motivo').value = '';
  document.getElementById('anular-pago-operador').value = '';
  document.getElementById('anular-pago-rol').value = 'Administrador';
  modal.classList.add('open');
}

function cerrarModalAnular() {
  const modal = document.getElementById('modal-anular-pago');
  if (modal) modal.classList.remove('open');
}

async function confirmarAnulacionPago(event) {
  event.preventDefault();
  const idPago = document.getElementById('anular-pago-id').value;
  const rol = document.getElementById('anular-pago-rol').value;
  const operador = document.getElementById('anular-pago-operador').value.trim();
  const motivo = document.getElementById('anular-pago-motivo').value.trim();

  if (rol !== 'Administrador') {
    alert('Operación denegada: Solo el usuario con rol Administrador tiene autorización para anular registros de pago.');
    return;
  }
  if (!motivo) {
    alert('Debe suministrar una justificación o motivo claro para la anulación.');
    return;
  }
  if (!operador) {
    alert('Debe indicar el nombre del administrador responsable.');
    return;
  }

  try {
    const res = await fetch(`/api/pagos/${idPago}/anular`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ rol, operador, motivo })
    });
    const result = await res.json();
    if (!res.ok) {
      alert(result.error || 'No fue posible anular el pago.');
      return;
    }
    cerrarModalAnular();
    mostrarToast('Pago anulado y mensualidad cancelada exitosamente.');
    await Promise.all([
      cargarPagos(),
      cargarMensualidades(),
      cargarMensualistas()
    ]);
  } catch (err) {
    alert('Error al comunicarse con el servidor para anular el pago.');
  }
}

async function cargarMensualidades() {
  const tbody = document.getElementById('tbody-mensualidades');
  if (!tbody) return;
  tbody.replaceChildren();

  const estado = document.getElementById('filtro-mensualidad-estado')?.value || '';
  const proximas = document.getElementById('filtro-mensualidad-proximas')?.checked || false;

  const params = new URLSearchParams();
  if (estado) params.set('estado', estado);
  if (proximas) params.set('proximas', 'true');

  try {
    const res = await fetch(`/api/mensualidades?${params.toString()}`);
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'No fue posible consultar mensualidades.');

    if (data.length === 0) {
      addEmptyRow(tbody, 7, 'No se encontraron mensualidades con los filtros indicados.');
      return;
    }

    data.forEach(m => {
      let badgeClase = 'badge-vigente';
      if (m.estado === 'Vencida') badgeClase = 'badge-vencida';
      else if (m.estado === 'Cancelada') badgeClase = 'badge-anulado';

      let textoVencimiento = '-';
      if (m.dias_restantes != null) {
        if (m.dias_restantes > 0) {
          if (m.dias_restantes <= 5) {
            textoVencimiento = `<span class="badge badge-por-vencer">En ${m.dias_restantes} día(s)</span>`;
          } else {
            textoVencimiento = `${m.dias_restantes} días`;
          }
        } else if (m.dias_restantes === 0) {
          textoVencimiento = `<span class="badge badge-vencida">Vence hoy</span>`;
        } else {
          textoVencimiento = `<span style="color: var(--status-occupied); font-size: 0.8rem;">Vencida hace ${Math.abs(m.dias_restantes)} día(s)</span>`;
        }
      }

      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td>${escapeHtml(m.documento_usuario || '')}</td>
        <td><strong>${escapeHtml(m.usuario_nombre || 'N/A')}</strong></td>
        <td><span class="plate-badge">${escapeHtml(m.placa)}</span></td>
        <td>${escapeHtml(m.tipo_vehiculo || '')}</td>
        <td style="font-size: 0.84rem;">${escapeHtml(m.fecha_inicio)} al ${escapeHtml(m.fecha_fin)}</td>
        <td><span class="badge ${badgeClase}">${escapeHtml(m.estado)}</span></td>
        <td>${textoVencimiento}</td>
      `;
      tbody.appendChild(tr);
    });
  } catch (err) {
    addEmptyRow(tbody, 7, 'No fue posible cargar el estado de mensualidades.');
    mostrarToast(err.message || 'Error al cargar mensualidades');
  }
}
