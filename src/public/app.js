let estadoPatio = { estadisticas: {}, celdas: [], activos: [] };
let vehiculoValidado = null;
let accesoParaSalida = null;
let celdaPreseleccionada = null;

document.addEventListener('DOMContentLoaded', () => {
  iniciarReloj();
  cargarPatio();
  configurarAtajosTeclado();
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
  contenedor.innerHTML = '';

  celdas.forEach(cel => {
    const ocupante = activos.find(a => a.id_celda === cel.id_celda);
    const item = document.createElement('div');
    item.className = `cell-item ${cel.estado.toLowerCase()}`;

    let contenidoPlaca = '';
    if (ocupante) {
      contenidoPlaca = `<span class="cell-plate">${ocupante.placa}</span>`;
      item.onclick = () => abrirModalSalida(ocupante.id_acceso);
    } else {
      item.onclick = () => abrirModalEntradaConCelda(cel.id_celda);
    }

    item.innerHTML = `
      <div>
        <div class="cell-code">${cel.codigo}</div>
        <div class="cell-type">${cel.tipo} • ${cel.sector}</div>
      </div>
      <div>
        ${contenidoPlaca}
        <div class="cell-status-text">${cel.estado}</div>
      </div>
    `;
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
      novedadesHtml = a.novedades.map(n => `<span class="badge badge-novedad" title="${n.descripcion}">${n.tipo}</span>`).join(' ');
    }

    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td><span class="plate-badge">${a.placa}</span></td>
      <td><strong>${a.cliente}</strong><br><small style="color: var(--text-muted);">${a.telefono}</small></td>
      <td>${a.tipo} - ${a.marca}</td>
      <td><strong style="font-family: 'Space Mono';">${a.codigo_celda}</strong></td>
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
        <div class="val-title">${data.mensaje || 'Validacion denegada'}</div>
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
      <div class="val-title">Mensualidad Activa: ${data.usuario.nombres}</div>
      <div class="val-detail">
        Vehiculo: <strong>${data.vehiculo.tipo} ${data.vehiculo.marca} ${data.vehiculo.modelo}</strong> (${data.vehiculo.color})<br>
        Vigencia plan: <strong>${data.mensualidad.fecha_inicio} al ${data.mensualidad.fecha_fin}</strong>
      </div>
    `;

    selCelda.disabled = false;
    selCelda.innerHTML = '';
    if (data.celdasDisponibles.length === 0) {
      selCelda.innerHTML = `<option value="">No hay celdas disponibles para ${data.vehiculo.tipo}</option>`;
      btn.disabled = true;
    } else {
      data.celdasDisponibles.forEach(c => {
        selCelda.innerHTML += `<option value="${c.id_celda}">Celda ${c.codigo} (${c.sector})</option>`;
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
    novedadesPrevias = activo.novedades.map(n => `<div style="font-size: 0.85rem; margin-top: 0.3rem;"><strong style="color: var(--accent-amber);">${n.tipo}:</strong> ${n.descripcion}</div>`).join('');
  }

  cont.innerHTML = `
    <div class="summary-card">
      <div class="summary-row">
        <span>Vehiculo:</span>
        <strong>${activo.placa} (${activo.tipo} ${activo.marca})</strong>
      </div>
      <div class="summary-row">
        <span>Cliente Abonado:</span>
        <strong>${activo.cliente}</strong>
      </div>
      <div class="summary-row">
        <span>Celda Actual:</span>
        <strong style="color: var(--accent-amber);">${activo.codigo_celda}</strong>
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
      Al confirmar, la celda <strong>${activo.codigo_celda}</strong> quedara inmediatamente DISPONIBLE.
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
        <td><span class="plate-badge">${m.placa}</span></td>
        <td><strong>${m.cliente}</strong></td>
        <td>${m.documento}</td>
        <td>${m.telefono}</td>
        <td>${m.tipo} - ${m.marca} ${m.modelo} (${m.color})</td>
        <td><span class="badge ${badgeClase}">${m.estadoMensualidad}</span></td>
        <td>${m.fechaFin}</td>
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
        <td><span class="plate-badge">${h.placa}</span></td>
        <td>${h.cliente}</td>
        <td><strong style="font-family: 'Space Mono';">${h.celda}</strong></td>
        <td>${h.operador}</td>
        <td>${fechaEnt}</td>
        <td>${fechaSal}</td>
        <td>${mins}</td>
        <td style="font-size: 0.8rem; color: var(--text-muted);">${novs}</td>
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
