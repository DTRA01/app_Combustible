
// ============================================
// SISTEMA DE LOGIN Y ROLES v2.4 (GitHub Gists)
// ============================================
let SESSION = null;
let USUARIOS_LOCAL = [];

// ============================================
// API GITHUB GISTS
// ============================================
async function apiGist(method, endpoint, body = null) {
  const headers = {
    'Accept': 'application/vnd.github+json',
    'Authorization': 'Bearer ' + STATE.cloud.apiKey,
    'X-GitHub-Api-Version': '2026-03-10',
    'Content-Type': 'application/json'
  };
  const opts = { method, headers };
  if (body) opts.body = JSON.stringify(body);
  const url = endpoint.startsWith('http') ? endpoint : 'https://api.github.com' + endpoint;
  const res = await fetch(url, opts);
  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`HTTP ${res.status}: ${errText}`);
  }
  return res.json();
}

async function testCloudConnection() {
  if (!STATE.cloud.connected) {
    showAlert('error', 'Firebase no está configurado. Verificá config.js');
    return false;
  }
  setLoading(true);
  try {
    // Verificar que Firestore responde
    await STATE.db.collection('partes').limit(1).get();
    showAlert('success', 'Conectado a Firebase correctamente.');
    return true;
  } catch (e) {
    showAlert('error', 'Error conectando a Firebase: ' + e.message);
    return false;
  } finally {
    setLoading(false);
  }
}

// Funciones de Gist eliminadas - ahora usamos Firestore directamente

// ============================================
// LOGIN
// ============================================
async function cargarUsuariosDesdeNube() {
  if (!STATE.db) return false;
  try {
    const snapshot = await STATE.db.collection('usuarios').get();
    USUARIOS_LOCAL = [];
    snapshot.forEach(doc => {
      const data = doc.data();
      USUARIOS_LOCAL.push({
        uid: doc.id,
        dni: data.dni || '-',
        nombre: data.nombre,
        username: data.email,
        email: data.email,
        password: '',
        rol: data.rol
      });
    });
    console.log('[CARGAR] Usuarios cargados desde Firebase:', USUARIOS_LOCAL.length);
    return true;
  } catch (e) {
    console.log('No se pudieron cargar usuarios:', e.message);
    return false;
  }
}

async function doLogin() {
  const user = document.getElementById('login-user').value.trim();
  const pass = document.getElementById('login-pass').value;
  const errorEl = document.getElementById('login-error');

  if (!user || !pass) {
    errorEl.textContent = 'Ingresá usuario y contraseña';
    errorEl.classList.add('active');
    return;
  }

  setLoading(true);
  try {
    // Intentar login con Firebase Auth
    const cred = await STATE.auth.signInWithEmailAndPassword(user, pass);
    const userDoc = await STATE.db.collection('usuarios').doc(cred.user.uid).get();

    if (!userDoc.exists) {
      throw new Error('Usuario no registrado en el sistema');
    }

    const data = userDoc.data();
    SESSION = {
      uid: cred.user.uid,
      email: cred.user.email,
      nombre: data.nombre,
      rol: data.rol,
      dni: data.dni || ''
    };

    sessionStorage.setItem('pna_session', JSON.stringify(SESSION));
    errorEl.classList.remove('active');
    document.getElementById('login-overlay').classList.remove('active');
    aplicarPermisos();
    showAlert('success', `Bienvenido, ${data.nombre} (${data.rol.toUpperCase()})`);
  } catch (e) {
    // Fallback a usuario de emergencia si Firebase no está configurado
    if (typeof USUARIO_EMERGENCIA !== 'undefined' && user === USUARIO_EMERGENCIA.username && pass === USUARIO_EMERGENCIA.password) {
      SESSION = { ...USUARIO_EMERGENCIA };
      sessionStorage.setItem('pna_session', JSON.stringify(SESSION));
      errorEl.classList.remove('active');
      document.getElementById('login-overlay').classList.remove('active');
      aplicarPermisos();
      showAlert('success', `Bienvenido, ${USUARIO_EMERGENCIA.nombre} (EMERGENCIA)`);
    } else {
      errorEl.textContent = 'Usuario o contraseña incorrectos';
      errorEl.classList.add('active');
    }
  } finally {
    setLoading(false);
  }
}

async function checkSession() {
  const saved = sessionStorage.getItem('pna_session');
  if (saved) {
    try {
      SESSION = JSON.parse(saved);
      document.getElementById('login-overlay').classList.remove('active');
      await cargarUsuariosDesdeNube();
      aplicarPermisos();
    } catch (e) {
      sessionStorage.removeItem('pna_session');
    }
  }

  // También escuchar cambios de estado de Firebase Auth
  if (STATE.auth) {
    STATE.auth.onAuthStateChanged(async (user) => {
      if (!user && !SESSION) {
        document.getElementById('login-overlay').classList.add('active');
      }
    });
  }
}

function cerrarSesion() {
  if (STATE.auth) STATE.auth.signOut();
  SESSION = null;
  sessionStorage.removeItem('pna_session');
  document.getElementById('login-overlay').classList.add('active');
  document.getElementById('login-user').value = '';
  document.getElementById('login-pass').value = '';
  document.getElementById('login-error').classList.remove('active');

  const badge = document.getElementById('user-badge');
  if (badge) badge.remove();

  const abm = document.getElementById('panel-abm-usuarios');
  if (abm) abm.style.display = 'none';

  const adminTab = document.querySelector('.nav-tab-item[data-tab="admin"]');
  if (adminTab) adminTab.style.display = 'none';

  const headerActions = document.getElementById('header-actions');
  if (headerActions) headerActions.innerHTML = '';

  STATE.data = {
    saldosServicios: [], saldosDTRA: [], ypfTerrestre: [], ypfSuperficie: [],
    gcSaldos: [], gcCondicion: [], consumoDiario: [], simo: [], lubricantes: []
  };
  STATE.files = {};
  destroyCharts();
  updateUI();

  const filesPanel = document.getElementById('files-panel');
  if (filesPanel) filesPanel.classList.remove('active');

  switchTab('resumen');
}

function aplicarPermisos() {
  if (!SESSION) return;

  const isAdmin = SESSION.rol === 'admin';

  // Header: usuario + logout
  const headerActions = document.getElementById('header-actions');
  if (headerActions) {
    headerActions.innerHTML = `
      <div class="user-badge">
        <span>${escapeHtml(SESSION.nombre)}</span>
        <span class="rol-tag ${SESSION.rol}">${SESSION.rol}</span>
      </div>
      <button class="btn-logout" onclick="cerrarSesion()">🚪 Salir</button>
    `;
  }

  // FIX: Mostrar/ocultar pestaña de Admin
  const adminTab = document.querySelector('.nav-tab-item[data-tab="admin"]');
  if (adminTab) {
    adminTab.style.display = isAdmin ? 'flex' : 'none';
  }

  // Panel ABM
  const abmPanel = document.getElementById('panel-abm-usuarios');
  if (abmPanel) abmPanel.style.display = isAdmin ? 'block' : 'none';

  // Botón eliminar en repositorio
  const btnEliminar = document.querySelector('#tab-repositorio .btn-glass-danger');
  if (btnEliminar) btnEliminar.style.display = isAdmin ? 'inline-flex' : 'none';

  if (isAdmin) renderTablaUsuarios();
}

// ============================================
// ABM USUARIOS
// ============================================
function renderTablaUsuarios() {
  const tbody = document.getElementById('tbody-usuarios');
  if (!tbody) return;

  if (USUARIOS_LOCAL.length === 0) {
    tbody.innerHTML = '<tr><td colspan="5" style="text-align:center;padding:20px;color:var(--text-muted);">No hay usuarios. Agregá el primero.</td></tr>';
    return;
  }

  tbody.innerHTML = USUARIOS_LOCAL.map((u, i) => `
    <tr data-idx="${i}">
      <td>${escapeHtml(u.dni || '-')}</td>
      <td>${escapeHtml(u.nombre)}</td>
      <td>${escapeHtml(u.username)}</td>
      <td><span class="badge-custom badge-${u.rol}">${u.rol.toUpperCase()}</span></td>
      <td style="text-align:center;">
        <button class="repo-item-btn edit" onclick="editarUsuario(${i})" title="Editar">✏️</button>
        <button class="repo-item-btn" onclick="eliminarUsuario(${i})" title="Eliminar">🗑</button>
      </td>
    </tr>
  `).join('');

  const status = document.getElementById('abm-status');
  if (status) status.textContent = `${USUARIOS_LOCAL.length} usuario(s) cargado(s) desde la nube.`;
}

async function agregarUsuario() {
  const dni = document.getElementById('abm-dni').value.trim();
  const nombre = document.getElementById('abm-nombre').value.trim();
  const email = document.getElementById('abm-user').value.trim();
  const pass = document.getElementById('abm-pass').value;
  const rol = document.getElementById('abm-rol').value;

  if (!email || !pass || !nombre) {
    showAlert('error', 'Email, nombre y contraseña son obligatorios');
    return;
  }

  if (!email.includes('@')) {
    showAlert('error', 'El usuario debe ser un email válido (ej: usuario@gmail.com)');
    return;
  }

  if (!STATE.db) {
    showAlert('error', 'Firebase no está configurado');
    return;
  }

  setLoading(true);
  try {
    const cred = await STATE.auth.createUserWithEmailAndPassword(email, pass);
    await STATE.db.collection('usuarios').doc(cred.user.uid).set({
      nombre: nombre,
      email: email,
      rol: rol,
      dni: dni || '-'
    });

    USUARIOS_LOCAL.push({
      uid: cred.user.uid,
      dni: dni || '-',
      nombre: nombre,
      username: email,
      email: email,
      password: '',
      rol: rol
    });

    renderTablaUsuarios();
    document.getElementById('abm-dni').value = '';
    document.getElementById('abm-nombre').value = '';
    document.getElementById('abm-user').value = '';
    document.getElementById('abm-pass').value = '';
    document.getElementById('abm-rol').value = 'user';

    showAlert('success', `Usuario "${email}" creado en Firebase.`);
    showAlert('success', 'Por favor, volvé a iniciar sesión con tu cuenta de administrador.');
    await STATE.auth.signOut();
    cerrarSesion();

  } catch (e) {
    showAlert('error', 'Error creando usuario: ' + e.message);
  } finally {
    setLoading(false);
  }
}

function editarUsuario(idx) {
  const u = USUARIOS_LOCAL[idx];
  if (!u) return;
  const nuevoNombre = prompt('Nombre completo:', u.nombre);
  if (nuevoNombre === null) return;
  const nuevoDNI = prompt('DNI:', u.dni || '');
  if (nuevoDNI === null) return;
  const nuevoRol = prompt('Rol (admin/user):', u.rol);
  if (nuevoRol === null) return;

  const actualizado = {
    nombre: nuevoNombre.trim() || u.nombre,
    dni: nuevoDNI.trim() || u.dni,
    rol: ['admin', 'user'].includes(nuevoRol) ? nuevoRol : u.rol
  };

  if (u.uid && STATE.db) {
    STATE.db.collection('usuarios').doc(u.uid).update(actualizado);
  }

  USUARIOS_LOCAL[idx] = { ...u, ...actualizado };
  renderTablaUsuarios();
  showAlert('success', `Usuario "${u.email}" actualizado.`);
}

function eliminarUsuario(idx) {
  const u = USUARIOS_LOCAL[idx];
  if (!u) return;
  if (!confirm(`¿Eliminar a ${u.nombre} (${u.email})?`)) return;

  if (u.uid && STATE.db) {
    STATE.db.collection('usuarios').doc(u.uid).delete();
  }

  USUARIOS_LOCAL.splice(idx, 1);
  renderTablaUsuarios();
  showAlert('success', 'Usuario eliminado de Firestore.');
}

async function guardarUsuariosEnNube() {
  if (!STATE.db) {
    showAlert('error', 'Firebase no está configurado');
    return;
  }
  if (!SESSION || SESSION.rol !== 'admin') {
    showAlert('error', 'Solo administradores pueden gestionar usuarios');
    return;
  }

  setLoading(true);
  try {
    for (const u of USUARIOS_LOCAL) {
      if (u.uid) {
        await STATE.db.collection('usuarios').doc(u.uid).set({
          nombre: u.nombre,
          email: u.email || u.username,
          rol: u.rol,
          dni: u.dni || '-'
        }, { merge: true });
      }
    }
    showAlert('success', `${USUARIOS_LOCAL.length} usuarios guardados en Firebase ✓`);
    const status = document.getElementById('abm-status');
    if (status) status.textContent = `Último guardado: ${new Date().toLocaleString('es-AR')}`;
  } catch (e) {
    showAlert('error', 'Error guardando usuarios: ' + e.message);
  } finally {
    setLoading(false);
  }
}

// ============================================
// GUARDAR PARTE DEL DÍA
// ============================================
function buildParteJSON(fecha) {
  const saldoTotal = STATE.data.saldosServicios.reduce((s, r) => s + (parseFloat(r.saldo_total) || 0), 0);
  const creditoT = STATE.data.ypfTerrestre.reduce((s, r) => s + (parseFloat(r.asignado_inicio) || 0), 0);
  const creditoS = STATE.data.ypfSuperficie.reduce((s, r) => s + (parseFloat(r.asignado_inicio) || 0), 0);
  const consumoT = STATE.data.ypfTerrestre.reduce((s, r) => s + (parseFloat(r.consumo_actual) || 0), 0);
  const consumoS = STATE.data.ypfSuperficie.reduce((s, r) => s + (parseFloat(r.consumo_actual) || 0), 0);
  const gcBravo = STATE.data.gcCondicion.filter(r => r.condicion === 'BRAVO').length;
  const gcTotal = STATE.data.gcSaldos.length;
  const gcLitros = STATE.data.gcSaldos.reduce((s, r) => s + (parseFloat(r.saldo_litros) || 0), 0);
  const lubTotal = STATE.data.lubricantes.reduce((s, r) => s + (parseFloat(r.precio_total) || 0), 0);
  const consumoDiarioAgg = STATE.data.consumoDiario.map(c => ({
    nombre: c.nombre,
    total_consumo: c.consumos.reduce((s, v) => s + (parseFloat(v) || 0), 0),
    total_limite: c.limites.reduce((s, v) => s + (parseFloat(v) || 0), 0),
    estado: c.estado
  }));

  return {
    meta: {
      fecha: fecha,
      version: '2.4',
      tipo: 'parte_diario_combustible',
      generado_por: 'Dashboard PNA',
      timestamp: new Date().toISOString(),
      fuentes: ['Planilla_Diaria', 'Saldos_GC', 'Consumo_Por_Dia']
    },
    resumen: {
      saldo_total_servicios: saldoTotal,
      credito_ypf_terrestre: creditoT,
      credito_ypf_superficie: creditoS,
      consumo_acumulado: consumoT + consumoS,
      gc_activos_bravo: gcBravo,
      gc_total_unidades: gcTotal,
      gc_litros_totales: gcLitros,
      lubricantes_total: lubTotal,
      simo_registros: STATE.data.simo.length
    },
    resumen_markdown: `## Parte Diario de Combustible — Prefectura Naval Argentina
**Fecha:** ${fecha}  
**Generado:** ${new Date().toLocaleString('es-AR')}

### 💰 Saldos de Servicios
| Servicio | Saldo Total |
|----------|-------------|
${STATE.data.saldosServicios.map(s => `| ${s.servicio} | ${fmtMoney(s.saldo_total)} |`).join('\\n')}

**Total consolidado:** ${fmtMoney(saldoTotal)}

### ⛽ YPF en Ruta — Terrestre
| Contrato | Asignado | Consumo | Saldo | Días Rest. |
|----------|----------|---------|-------|----------|
${STATE.data.ypfTerrestre.map(r => `| ${r.contrato} | ${fmtMoney(r.asignado_inicio)} | ${fmtMoney(r.consumo_actual)} | ${fmtMoney(r.saldo_actual)} | ${r.dias_restantes} |`).join('\\n')}

### 🌊 YPF en Ruta — Superficie
| Contrato | Asignado | Consumo | Saldo | Días Rest. |
|----------|----------|---------|-------|----------|
${STATE.data.ypfSuperficie.map(r => `| ${r.contrato} | ${fmtMoney(r.asignado_inicio)} | ${fmtMoney(r.consumo_actual)} | ${fmtMoney(r.saldo_actual)} | ${r.dias_restantes} |`).join('\\n')}

### 🚢 Guardacostas — Condición de Alistamiento
| Unidad | Condición | Saldo (L) | % Capacidad | Puerto |
|--------|-----------|-----------|-------------|--------|
${STATE.data.gcCondicion.map(r => `| ${r.guardacostas} | ${r.condicion} | ${fmtNumber(r.saldo_litros,0)} | ${fmtNumber(r.porcentaje,1)}% | ${r.puerto} |`).join('\\n')}

**Activos (BRAVO):** ${gcBravo} de ${gcTotal} unidades

### 📈 Consumo Diario — Medios Terrestres
| Dirección | Total Consumo | Estado |
|-----------|---------------|--------|
${consumoDiarioAgg.map(c => `| ${c.nombre} | ${fmtMoney(c.total_consumo)} | ${c.estado} |`).join('\\n')}

### 🛢️ Lubricantes — Previsión SBGC
| Producto | Cantidad | Precio Total |
|----------|----------|--------------|
${STATE.data.lubricantes.map(l => `| ${l.producto} | ${l.cantidad} | ${fmtMoney(l.precio_total)} |`).join('\\n')}

**Total lubricantes:** ${fmtMoney(lubTotal)}

---
*Parte generado automáticamente desde Dashboard PNA v2.4*`,
    datos_completos: {
      saldosServicios: STATE.data.saldosServicios,
      saldosDTRA: STATE.data.saldosDTRA,
      ypfTerrestre: STATE.data.ypfTerrestre,
      ypfSuperficie: STATE.data.ypfSuperficie,
      gcSaldos: STATE.data.gcSaldos,
      gcCondicion: STATE.data.gcCondicion,
      consumoDiario: STATE.data.consumoDiario,
      simo: STATE.data.simo,
      lubricantes: STATE.data.lubricantes
    }
  };
}

async function guardarParteDiario() {
  if (!STATE.db) {
    showAlert('error', 'Firebase no está configurado');
    return;
  }
  if (!SESSION || SESSION.rol !== 'admin') {
    showAlert('error', 'Solo administradores pueden guardar partes');
    return;
  }

  const hasData = STATE.data.saldosServicios.length > 0 || 
                  STATE.data.ypfTerrestre.length > 0 || 
                  STATE.data.gcSaldos.length > 0;
  if (!hasData) {
    showAlert('error', 'No hay datos cargados. Arrastrá los 3 archivos Excel primero.');
    return;
  }

  const fechaInput = document.getElementById('repo-fecha-guardar');
  const fecha = fechaInput?.value || new Date().toISOString().split('T')[0];
  if (!fechaInput?.value) {
    showAlert('error', 'Seleccioná una fecha para el parte antes de guardar');
    fechaInput?.focus();
    return;
  }

  const parte = buildParteJSON(fecha);
  parte.createdBy = SESSION.uid;
  parte.createdByName = SESSION.nombre;
  parte.createdAt = firebase.firestore.FieldValue.serverTimestamp();

  setLoading(true);
  try {
    await STATE.db.collection('partes').doc(fecha).set(parte);
    showAlert('success', `Parte del ${fecha} guardado en Firebase ✓`);
    listarPartesGuardados();
  } catch (e) {
    showAlert('error', 'Error guardando: ' + e.message);
    console.error(e);
  } finally {
    setLoading(false);
  }
}

async function listarPartesGuardados() {
  if (!STATE.db) {
    showAlert('error', 'Firebase no está configurado');
    return;
  }

  setLoading(true);
  try {
    const snapshot = await STATE.db.collection('partes').orderBy('meta.fecha', 'desc').get();
    const container = document.getElementById('repo-lista');
    if (!container) return;

    if (snapshot.empty) {
      container.innerHTML = '<p style="color:var(--text-muted);font-size:13px;padding:20px;text-align:center;">No hay partes guardados en Firebase todavía.</p>';
      setLoading(false);
      return;
    }

    let html = '';
    snapshot.forEach(doc => {
      const p = doc.data();
      const res = p.resumen || {};
      const f = doc.id;
      html += `
        <div class="repo-item" onclick="cargarParteDelDia('${f}')" data-fecha="${f}">
          <div>
            <div class="repo-item-fecha">📅 ${f}</div>
            <div class="repo-item-meta">
              GC: ${res.gc_total_unidades || 0} unid · 
              YPF: ${fmtMoney((res.credito_ypf_terrestre || 0) + (res.credito_ypf_superficie || 0))} · 
              SIMO: ${res.simo_registros || 0} regs
            </div>
          </div>
          <div class="repo-item-actions">
            <button class="repo-item-btn view" onclick="event.stopPropagation();cargarParteDelDia('${f}')" title="Ver">👁</button>
            ${SESSION && SESSION.rol === 'admin' ? `<button class="repo-item-btn" onclick="event.stopPropagation();eliminarParte('${f}')" title="Eliminar">🗑</button>` : ''}
          </div>
        </div>
      `;
    });

    container.innerHTML = html;
    showAlert('success', `${snapshot.size} partes cargados desde Firebase`);
  } catch (e) {
    showAlert('error', 'Error cargando: ' + e.message);
  } finally {
    setLoading(false);
  }
}

async function cargarParteDelDia(fecha) {
  if (!STATE.db) {
    showAlert('error', 'Firebase no está configurado');
    return;
  }
  setLoading(true);
  try {
    const doc = await STATE.db.collection('partes').doc(fecha).get();
    if (!doc.exists) {
      showAlert('error', `No se encontró parte para ${fecha}`);
      setLoading(false);
      return;
    }

    const parte = doc.data();
    if (parte.datos_completos) {
      STATE.data = {
        saldosServicios: parte.datos_completos.saldosServicios || [],
        saldosDTRA: parte.datos_completos.saldosDTRA || [],
        ypfTerrestre: parte.datos_completos.ypfTerrestre || [],
        ypfSuperficie: parte.datos_completos.ypfSuperficie || [],
        gcSaldos: parte.datos_completos.gcSaldos || [],
        gcCondicion: parte.datos_completos.gcCondicion || [],
        consumoDiario: parte.datos_completos.consumoDiario || [],
        simo: parte.datos_completos.simo || [],
        lubricantes: parte.datos_completos.lubricantes || []
      };
    }

    updateUI();
    switchTab('resumen');

    document.querySelectorAll('.repo-item').forEach(el => el.classList.remove('active'));
    const active = document.querySelector(`.repo-item[data-fecha="${fecha}"]`);
    if (active) active.classList.add('active');

    const vista = document.getElementById('repo-vista-previa');
    if (vista) {
      vista.style.display = 'block';
      document.getElementById('repo-fecha-actual').textContent = fecha;
      const res = parte.resumen || {};
      const kpis = document.getElementById('repo-kpis');
      if (kpis) {
        kpis.innerHTML = `
          <div class="kpi-card kpi-accent"><div class="kpi-icon">💰</div><div class="kpi-label">Saldo Total Servicios</div><div class="kpi-value">${fmtMoney(res.saldo_total_servicios)}</div></div>
          <div class="kpi-card kpi-success"><div class="kpi-icon">⛽</div><div class="kpi-label">Crédito YPF Terrestre</div><div class="kpi-value">${fmtMoney(res.credito_ypf_terrestre)}</div></div>
          <div class="kpi-card kpi-warning"><div class="kpi-icon">🌊</div><div class="kpi-label">Crédito YPF Superficie</div><div class="kpi-value">${fmtMoney(res.credito_ypf_superficie)}</div></div>
          <div class="kpi-card kpi-danger"><div class="kpi-icon">📉</div><div class="kpi-label">Consumo Acumulado</div><div class="kpi-value">${fmtMoney(res.consumo_acumulado)}</div></div>
          <div class="kpi-card kpi-info"><div class="kpi-icon">🚢</div><div class="kpi-label">GC Activos BRAVO</div><div class="kpi-value">${res.gc_activos_bravo || 0}</div></div>
          <div class="kpi-card kpi-success"><div class="kpi-icon">🛢️</div><div class="kpi-label">Lubricantes</div><div class="kpi-value">${fmtMoney(res.lubricantes_total)}</div></div>
        `;
      }
    }
    showAlert('success', `Parte del ${fecha} cargado. Datos restaurados en todas las pestañas.`);
  } catch (e) {
    showAlert('error', 'Error cargando parte: ' + e.message);
    console.error(e);
  } finally {
    setLoading(false);
  }
}

async function eliminarParte(fecha) {
  if (!SESSION || SESSION.rol !== 'admin') {
    showAlert('error', 'Solo administradores pueden eliminar partes');
    return;
  }
  if (!confirm(`¿Eliminar el parte del ${fecha}?`)) return;
  setLoading(true);
  try {
    await STATE.db.collection('partes').doc(fecha).delete();
    showAlert('success', `Parte ${fecha} eliminado`);
    listarPartesGuardados();
  } catch (e) {
    showAlert('error', 'Error eliminando: ' + e.message);
  } finally {
    setLoading(false);
  }
}

function eliminarParteSeleccionado() {
  const active = document.querySelector('.repo-item.active');
  if (!active) { showAlert('error', 'Seleccioná un parte primero'); return; }
  eliminarParte(active.getAttribute('data-fecha'));
}

// ============================================
// COMPARATIVA
// ============================================
async function compararFechas() {
  const fechaA = document.getElementById('comp-fecha-a')?.value;
  const fechaB = document.getElementById('comp-fecha-b')?.value;
  if (!fechaA || !fechaB) { showAlert('error', 'Seleccioná ambas fechas'); return; }
  if (!STATE.db) { showAlert('error', 'Firebase no está configurado'); return; }

  setLoading(true);
  try {
    const [docA, docB] = await Promise.all([
      STATE.db.collection('partes').doc(fechaA).get(),
      STATE.db.collection('partes').doc(fechaB).get()
    ]);

    if (!docA.exists || !docB.exists) {
      showAlert('error', 'Una o ambas fechas no tienen parte guardado');
      setLoading(false);
      return;
    }

    const parteA = docA.data();
    const parteB = docB.data();
    const rA = parteA.resumen || {};
    const rB = parteB.resumen || {};
    const indicadores = [
      { nombre: 'Saldo Total Servicios', a: rA.saldo_total_servicios || 0, b: rB.saldo_total_servicios || 0 },
      { nombre: 'Crédito YPF Terrestre', a: rA.credito_ypf_terrestre || 0, b: rB.credito_ypf_terrestre || 0 },
      { nombre: 'Crédito YPF Superficie', a: rA.credito_ypf_superficie || 0, b: rB.credito_ypf_superficie || 0 },
      { nombre: 'Consumo Acumulado', a: rA.consumo_acumulado || 0, b: rB.consumo_acumulado || 0 },
      { nombre: 'GC Activos BRAVO', a: rA.gc_activos_bravo || 0, b: rB.gc_activos_bravo || 0 },
      { nombre: 'GC Total Unidades', a: rA.gc_total_unidades || 0, b: rB.gc_total_unidades || 0 },
      { nombre: 'Lubricantes Total', a: rA.lubricantes_total || 0, b: rB.lubricantes_total || 0 }
    ];
    const resultados = document.getElementById('comp-resultados');
    if (resultados) resultados.style.display = 'block';
    const tbody = document.getElementById('comp-tabla-body');
    if (tbody) {
      tbody.innerHTML = indicadores.map(ind => {
        const diff = ind.b - ind.a;
        const pct = ind.a !== 0 ? ((diff / Math.abs(ind.a)) * 100).toFixed(1) : (diff > 0 ? '∞' : '0');
        const cls = diff > 0 ? 'positive' : diff < 0 ? 'negative' : 'neutral';
        const sign = diff > 0 ? '+' : '';
        return `<tr><td>${ind.nombre}</td><td style="text-align:right;font-family:monospace;">${fmtMoney(ind.a)}</td><td style="text-align:right;font-family:monospace;">${fmtMoney(ind.b)}</td><td style="text-align:right;font-family:monospace;" class="comp-delta ${cls}">${sign}${fmtMoney(diff)}</td><td style="text-align:center;" class="comp-delta ${cls}">${sign}${pct}%</td></tr>`;
      }).join('');
    }
    const kpis = document.getElementById('comp-kpis');
    if (kpis) {
      const diffConsumo = (rB.consumo_acumulado || 0) - (rA.consumo_acumulado || 0);
      const diffSaldo = (rB.saldo_total_servicios || 0) - (rA.saldo_total_servicios || 0);
      kpis.innerHTML = `
        <div class="kpi-card kpi-accent"><div class="kpi-label">Diferencia en Consumo</div><div class="kpi-value ${diffConsumo > 0 ? 'negative' : 'positive'}">${fmtMoney(diffConsumo)}</div></div>
        <div class="kpi-card kpi-success"><div class="kpi-label">Diferencia en Saldos</div><div class="kpi-value ${diffSaldo > 0 ? 'positive' : 'negative'}">${fmtMoney(diffSaldo)}</div></div>
        <div class="kpi-card kpi-info"><div class="kpi-label">GC Activos</div><div class="kpi-value">${rB.gc_activos_bravo || 0} vs ${rA.gc_activos_bravo || 0}</div></div>
      `;
    }
    showAlert('success', `Comparativa ${fechaA} vs ${fechaB} generada`);
  } catch (e) {
    showAlert('error', 'Error en comparativa: ' + e.message);
  } finally {
    setLoading(false);
  }
}

// ============================================
// PREVISIONES
// ============================================
async function generarPrevision() {
  const periodo = document.getElementById('prev-periodo')?.value || 'mensual';
  const desde = document.getElementById('prev-fecha-desde')?.value;
  if (!STATE.cloud.binId) { showAlert('error', 'Configurá el repositorio en la nube primero'); return; }
  setLoading(true);
  try {
    const data = await leerGist();
    const partes = data?.partes || {};
    const fechas = Object.keys(partes).sort();
    if (fechas.length < 2) { showAlert('error', 'Necesitás al menos 2 partes guardados'); setLoading(false); return; }
    let fechasFiltradas = fechas;
    if (desde) fechasFiltradas = fechas.filter(f => f >= desde);
    const historial = fechasFiltradas.map(f => ({ fecha: f, resumen: partes[f].resumen || {}, markdown: partes[f].resumen_markdown || '' }));
    const resumenes = historial.map(h => h.resumen);
    const avg = (arr, key) => arr.reduce((s, r) => s + (r[key] || 0), 0) / arr.length;
    const proyeccion = {
      meta: { tipo: 'prevision', periodo: periodo, basado_en: fechasFiltradas.length + ' partes', rango_fechas: fechasFiltradas[0] + ' a ' + fechasFiltradas[fechasFiltradas.length - 1], generado: new Date().toISOString() },
      historial_resumido: historial.map(h => ({ fecha: h.fecha, saldo_total: h.resumen.saldo_total_servicios, consumo: h.resumen.consumo_acumulado, gc_activos: h.resumen.gc_activos_bravo, lubricantes: h.resumen.lubricantes_total })),
      promedios: { saldo_promedio: avg(resumenes, 'saldo_total_servicios'), consumo_promedio: avg(resumenes, 'consumo_acumulado'), gc_activos_promedio: avg(resumenes, 'gc_activos_bravo'), lubricantes_promedio: avg(resumenes, 'lubricantes_total') },
      prompt_ia: `Sos un asistente especializado en gestión de combustibles de la Prefectura Naval Argentina.

Te paso el historial de ${fechasFiltradas.length} partes diarios de combustible. Necesito que analices las tendencias y generes previsiones para el período ${periodo.toUpperCase()}.

## DATOS HISTÓRICOS (resumen):
${historial.map(h => `- ${h.fecha}: Saldo ${fmtMoney(h.resumen.saldo_total_servicios)}, Consumo ${fmtMoney(h.resumen.consumo_acumulado)}, GC activos ${h.resumen.gc_activos_bravo}`).join('\\n')}

## PROMEDIOS:
- Saldo promedio: ${fmtMoney(avg(resumenes, 'saldo_total_servicios'))}
- Consumo promedio: ${fmtMoney(avg(resumenes, 'consumo_acumulado'))}
- GC activos promedio: ${avg(resumenes, 'gc_activos_bravo').toFixed(1)}

## PREGUNTAS A RESPONDER:
1. ¿Cuál es la tendencia de consumo? ¿Aumenta, disminuye o es estable?
2. ¿Cuántas partidas (cargas de combustible) se estiman para el próximo ${periodo}?
3. ¿Proyección presupuestaria: cuánto se necesitará de crédito YPF terrestre y superficie?
4. ¿Qué guardacostas están en riesgo de quedarse sin combustible?
5. ¿Alertas o recomendaciones para la dirección?

Respondé en español, con formato Markdown, incluyendo tablas si es necesario.`
    };
    const resultados = document.getElementById('prev-resultados');
    if (resultados) resultados.style.display = 'block';
    const kpis = document.getElementById('prev-kpis');
    if (kpis) {
      kpis.innerHTML = `
        <div class="kpi-card kpi-accent"><div class="kpi-label">Partes Analizados</div><div class="kpi-value">${fechasFiltradas.length}</div></div>
        <div class="kpi-card kpi-success"><div class="kpi-label">Consumo Promedio</div><div class="kpi-value">${fmtMoney(avg(resumenes, 'consumo_acumulado'))}</div></div>
        <div class="kpi-card kpi-warning"><div class="kpi-label">Saldo Promedio</div><div class="kpi-value">${fmtMoney(avg(resumenes, 'saldo_total_servicios'))}</div></div>
      `;
    }
    const tbody = document.getElementById('prev-tabla-body');
    if (tbody) {
      const servicios = ['SEAV', 'SBGC', 'VISA FLOTA', 'VALES ACA'];
      tbody.innerHTML = servicios.map(svc => {
        const ultimo = partes[fechas[fechas.length - 1]];
        const saldoSvc = ultimo?.datos_completos?.saldosServicios?.find(s => s.servicio.includes(svc));
        const saldo = saldoSvc ? parseFloat(saldoSvc.saldo_total) || 0 : 0;
        const consumoProm = avg(resumenes, 'consumo_acumulado') / 4;
        const proy = consumoProm * (periodo === 'mensual' ? 1 : periodo === 'cuatrimestral' ? 4 : periodo === 'semestral' ? 6 : 12);
        const saldoProy = saldo - proy;
        const estado = saldoProy > 0 ? 'ok' : saldoProy > -consumoProm ? 'adv' : 'crit';
        const estadoLabel = estado === 'ok' ? 'OK' : estado === 'adv' ? 'Atención' : 'Crítico';
        return `<tr><td>${svc}</td><td style="text-align:right;">${fmtMoney(saldo)}</td><td style="text-align:right;">${fmtMoney(consumoProm)}</td><td style="text-align:right;">${fmtMoney(proy)}</td><td style="text-align:right;">${fmtMoney(saldoProy)}</td><td style="text-align:center;"><span class="estado-badge estado-${estado}">${estadoLabel}</span></td></tr>`;
      }).join('');
    }
    const alertas = document.getElementById('prev-alertas');
    if (alertas) {
      const ultimo = partes[fechas[fechas.length - 1]];
      const gcBajos = (ultimo?.datos_completos?.gcCondicion || []).filter(g => parseFloat(g.porcentaje) < 30);
      alertas.innerHTML = `
        <div class="prev-alerta info"><div class="prev-alerta-icon">📊</div><div class="prev-alerta-content"><h4>Dataset para IA generado</h4><p>Copiá el JSON completo o usá el prompt preparado para consultar a tu asistente IA favorito.</p></div></div>
        ${gcBajos.length > 0 ? `<div class="prev-alerta advertencia"><div class="prev-alerta-icon">⚠️</div><div class="prev-alerta-content"><h4>Guardacostas con bajo combustible</h4><p>${gcBajos.map(g => g.guardacostas + ' (' + fmtNumber(g.porcentaje,1) + '%)').join(', ')}</p></div></div>` : ''}
        <div class="prev-alerta ok"><div class="prev-alerta-icon">✅</div><div class="prev-alerta-content"><h4>Datos listos para exportar</h4><p>Usá el botón "Copiar JSON para IA" para llevar los datos a tu asistente virtual.</p></div></div>
      `;
    }
    window._ultimaProyeccion = proyeccion;
    showAlert('success', 'Previsión generada. Copiá el JSON para consultar a la IA.');
  } catch (e) {
    showAlert('error', 'Error generando previsión: ' + e.message);
    console.error(e);
  } finally {
    setLoading(false);
  }
}

function copiarJSONParaIA() {
  if (!window._ultimaProyeccion) { showAlert('error', 'Generá una previsión primero'); return; }
  const json = JSON.stringify(window._ultimaProyeccion, null, 2);
  navigator.clipboard.writeText(json).then(() => {
    showAlert('success', 'JSON copiado al portapapeles. Pegalo en tu asistente IA.');
  }).catch(() => {
    showAlert('error', 'Error copiando. Copiá manualmente desde la consola.');
    console.log('JSON para IA:', json);
  });
}

function copiarPromptIA() {
  if (!window._ultimaProyeccion) { showAlert('error', 'Generá una previsión primero'); return; }
  navigator.clipboard.writeText(window._ultimaProyeccion.prompt_ia).then(() => {
    showAlert('success', 'Prompt copiado. Pegalo en ChatGPT/Claude/etc.');
  });
}

// ============================================
// INICIALIZACIÓN
// ============================================

/* ============================================
   DASHBOARD PNA - V2.0
   Bootstrap 5 + Glassmorphism + Modern Navy
   ============================================ */

'use strict';

const STATE = {
  files: {},
  data: {
    saldosServicios: [],
    saldosDTRA: [],
    ypfTerrestre: [],
    ypfSuperficie: [],
    gcSaldos: [],
    gcCondicion: [],
    consumoDiario: [],
    simo: [],
    lubricantes: []
  },
  pagination: {},
  sort: {},
  charts: {},
  cloud: { connected: false }
};

// Inicializar Firebase
if (typeof FIREBASE_CONFIG !== 'undefined' && FIREBASE_CONFIG.apiKey && FIREBASE_CONFIG.apiKey !== 'PEGA_AQUI_TU_API_KEY') {
  firebase.initializeApp(FIREBASE_CONFIG);
  STATE.db = firebase.firestore();
  STATE.auth = firebase.auth();
  STATE.cloud.connected = true;
  console.log('[FIREBASE] Inicializado correctamente');
} else {
  console.warn('[FIREBASE] Configuración no encontrada o incompleta. Usando modo local.');
}

const ROWS_PER_PAGE = 15;

// ============================================
// UTILIDADES
// ============================================
function fmtMoney(val) {
  if (val === null || val === undefined || val === '') return '-';
  const num = parseFloat(val);
  if (isNaN(num)) return String(val);
  const sign = num < 0 ? '-' : '';
  return sign + '$' + Math.abs(num).toLocaleString('es-AR', {
    minimumFractionDigits: 2, maximumFractionDigits: 2
  });
}

function fmtNumber(val, decimals = 0) {
  if (val === null || val === undefined || val === '') return '-';
  const num = parseFloat(val);
  if (isNaN(num)) return String(val);
  return num.toLocaleString('es-AR', {
    minimumFractionDigits: decimals, maximumFractionDigits: decimals
  });
}

function fmtDate(val) {
  if (!val) return '-';
  if (val instanceof Date) return val.toLocaleDateString('es-AR');
  if (typeof val === 'number') {
    const epoch = new Date(1899, 11, 30);
    const d = new Date(epoch.getTime() + val * 86400000);
    return d.toLocaleDateString('es-AR');
  }
  return String(val);
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = String(text ?? '');
  return div.innerHTML;
}

function showAlert(type, msg) {
  const el = document.getElementById('alert-' + type);
  document.getElementById('alert-' + type + '-msg').textContent = msg;
  el.classList.add('active');
  setTimeout(() => el.classList.remove('active'), 5000);
}

function setLoading(show) {
  document.getElementById('loading-overlay').classList.toggle('active', show);
}

// ============================================
// DRAG & DROP
// ============================================
function handleDragOver(e) {
  e.preventDefault();
  e.stopPropagation();
  document.getElementById('drop-zone').classList.add('drag-over');
}

function handleDragLeave(e) {
  e.preventDefault();
  e.stopPropagation();
  document.getElementById('drop-zone').classList.remove('drag-over');
}

function handleDrop(e) {
  e.preventDefault();
  e.stopPropagation();
  document.getElementById('drop-zone').classList.remove('drag-over');
  processFiles(Array.from(e.dataTransfer.files));
}

function handleFiles(e) {
  processFiles(Array.from(e.target.files));
}

function processFiles(files) {
  if (!files.length) return;
  setLoading(true);
  let processed = 0;
  files.forEach(file => {
    const reader = new FileReader();
    reader.onload = function(ev) {
      try {
        const data = new Uint8Array(ev.target.result);
        const wb = XLSX.read(data, { type: 'array', cellDates: true });
        classifyAndParse(file.name, wb);
        processed++;
        if (processed === files.length) {
          setLoading(false);
          updateUI();
          showAlert('success', `${files.length} archivo(s) procesado(s) correctamente`);
        }
      } catch (err) {
        console.error(err);
        showAlert('error', 'Error al leer ' + file.name + ': ' + err.message);
        processed++;
        if (processed === files.length) setLoading(false);
      }
    };
    reader.readAsArrayBuffer(file);
  });
}

// ============================================
// CLASIFICACIÓN Y PARSEO
// ============================================
function classifyAndParse(filename, wb) {
  const sheets = wb.SheetNames;
  const lowerName = filename.toLowerCase();
  let tipo = 'unknown';
  if (lowerName.includes('planilla') || lowerName.includes('diaria') || sheets.includes('SALDOS SERVICIOS')) {
    tipo = 'planilla';
  } else if (lowerName.includes('gc') || lowerName.includes('guardacosta') || sheets.includes('SALDOS GC')) {
    tipo = 'gc';
  } else if (lowerName.includes('consumo') || lowerName.includes('dia') || sheets.some(s => s.includes('POR DIA'))) {
    tipo = 'consumo';
  }
  STATE.files[filename] = { tipo, sheets, wb };
  if (tipo === 'planilla') parsePlanillaDiaria(wb);
  else if (tipo === 'gc') parseSaldosGC(wb);
  else if (tipo === 'consumo') parseConsumoDiario(wb);
}

function parsePlanillaDiaria(wb) {
  if (wb.SheetNames.includes('SALDOS SERVICIOS')) {
    const ws = wb.Sheets['SALDOS SERVICIOS'];
    const json = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });
    STATE.data.saldosServicios = [];
    for (let i = 0; i < json.length; i++) {
      const row = json[i];
      if (row[0] && ['SEAV','SBGC','VISA FLOTA','VALES ACA'].some(s => String(row[0]).includes(s))) {
        STATE.data.saldosServicios.push({
          servicio: String(row[0]).trim(),
          saldo_informado: row[1] || 0,
          op_pendiente: row[2] || '',
          monto_op: row[3] || 0,
          ff: row[4] || '',
          fecha_dispo: fmtDate(row[5]),
          saldo_total: row[6] || 0
        });
      }
    }
  }
  if (wb.SheetNames.includes('SALDOS DTRA')) {
    const ws = wb.Sheets['SALDOS DTRA'];
    const json = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });
    STATE.data.saldosDTRA = [];
    for (let i = 0; i < json.length; i++) {
      const row = json[i];
      if (row[0] && (String(row[0]).includes('SERVICIO') || String(row[0]).includes('VISA') || String(row[0]).includes('VALES'))) {
        STATE.data.saldosDTRA.push({
          concepto: String(row[0]).trim(),
          saldo_actual: row[1] || 0,
          consumo: row[3] || 0,
          prevision: row[5] || 0
        });
      }
    }
  }
  if (wb.SheetNames.includes('YPF EN RUTA')) {
    const ws = wb.Sheets['YPF EN RUTA'];
    const json = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });
    STATE.data.ypfTerrestre = [];
    STATE.data.ypfSuperficie = [];
    let mode = 'terrestre';
    for (let i = 0; i < json.length; i++) {
      const row = json[i];
      if (row[2] && String(row[2]).includes('SUPERFICIE')) { mode = 'superficie'; continue; }
      if (!row[0] || isNaN(parseFloat(row[0]))) continue;
      const obj = {
        n_contrato: row[0],
        contrato: String(row[1] || '').trim(),
        asignado_inicio: row[2] || 0,
        asignado_mes: row[3] || 0,
        consumo_actual: row[4] || 0,
        consumo_prom_dia: row[5] || 0,
        saldo_actual: row[6] || 0,
        dias_restantes: row[7] || 0,
        consumo_dias_rest: row[8] || 0,
        diferencia: row[9] || 0
      };
      if (mode === 'terrestre') STATE.data.ypfTerrestre.push(obj);
      else STATE.data.ypfSuperficie.push(obj);
    }
  }
}

function parseSaldosGC(wb) {
  if (wb.SheetNames.includes('SALDOS GC')) {
    const ws = wb.Sheets['SALDOS GC'];
    const json = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });
    STATE.data.gcSaldos = [];
    for (let i = 0; i < json.length; i++) {
      const row = json[i];
      if (row[0] && (String(row[0]).startsWith('GC-') || String(row[0]).startsWith('SB-'))) {
        STATE.data.gcSaldos.push({
          guardacostas: String(row[0]).trim(),
          saldo_litros: row[3] || 0,
          porcentaje: row[4] || 0,
          capacidad: row[5] || 0,
          consumo_dia: row[6] || 0
        });
      }
    }
  }
  if (wb.SheetNames.includes('COMPRA LUB.')) {
    const ws = wb.Sheets['COMPRA LUB.'];
    const json = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });
    STATE.data.lubricantes = [];
    for (let i = 0; i < json.length; i++) {
      const row = json[i];
      if (row[0] && typeof row[0] === 'number' && row[0] > 0) {
        STATE.data.lubricantes.push({
          cantidad: row[0],
          producto: String(row[1] || '').trim(),
          precio_unitario: row[2] || 0,
          precio_total: row[3] || 0
        });
      }
    }
  }
  if (wb.SheetNames.includes('Condicion GC')) {
    const ws = wb.Sheets['Condicion GC'];
    const json = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });
    STATE.data.gcCondicion = [];
    for (let i = 0; i < json.length; i++) {
      const row = json[i];
      if (row[0] && (String(row[0]).startsWith('GC-') || String(row[0]).startsWith('SB-'))) {
        STATE.data.gcCondicion.push({
          guardacostas: String(row[0]).trim(),
          saldo_litros: row[3] || 0,
          porcentaje: row[4] || 0,
          puerto: String(row[5] || '').trim(),
          condicion: String(row[6] || '').trim(),
          capacidad: row[8] || 0,
          consumo_dia: row[9] || 0
        });
      }
    }
  }
  if (wb.SheetNames.includes('Reporte SIMO')) {
    const ws = wb.Sheets['Reporte SIMO'];
    const json = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });
    STATE.data.simo = [];
    for (let i = 0; i < json.length; i++) {
      const row = json[i];
      if (row[0] && typeof row[0] === 'number' && row[0] > 0 && row[0] < 100) {
        STATE.data.simo.push({
          n: row[0],
          zona: String(row[1] || '').trim(),
          medio: String(row[5] || '').trim(),
          sigla: String(row[6] || '').trim(),
          alistamiento: String(row[8] || '').trim(),
          fecha: fmtDate(row[9]),
          detalle: String(row[11] || '').trim(),
          tipo_comb: String(row[12] || '').trim(),
          anio: row[13] || ''
        });
      }
    }
  }
}

function parseConsumoDiario(wb) {
  const sheetName = wb.SheetNames.find(s => s.includes('POR DIA')) || wb.SheetNames[0];
  const ws = wb.Sheets[sheetName];
  const json = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });
  const fechas = [];
  const headerRow = json[0] || [];
  for (let c = 4; c < headerRow.length; c++) {
    const val = headerRow[c];
    if (val instanceof Date || (typeof val === 'number' && val > 40000)) {
      fechas.push({ col: c, fecha: fmtDate(val) });
    }
  }
  STATE.data.consumoDiario = [];
  let i = 0;
  while (i < json.length) {
    const row = json[i];
    if (row[1] && ['DEDU','DPRO','DNOR','DCEN','DSUR','DIOP'].includes(String(row[1]).trim())) {
      const nombre = String(row[1]).trim();
      const nContrato = json[i+2] ? json[i+2][2] : '';
      const estado = json[i+3] ? json[i+3][2] : '';
      const limiteCredito = json[i+4] ? json[i+4][2] : 0;
      const limites = [];
      const consumos = [];
      for (const f of fechas) {
        limites.push(json[i+5] ? (json[i+5][f.col] || 0) : 0);
        consumos.push(json[i+6] ? (json[i+6][f.col] || 0) : 0);
      }
      STATE.data.consumoDiario.push({
        nombre, n_contrato: nContrato, estado, limite_credito: limiteCredito,
        fechas: fechas.map(f => f.fecha), limites, consumos
      });
      i += 11;
    } else {
      i++;
    }
  }
}

// ============================================
// UI
// ============================================
function updateUI() {
  updateFileTags();
  updateBadges();
  updateKPIs();
  renderAllTables();
  renderAllCharts();
}

function updateFileTags() {
  const container = document.getElementById('file-tags');
  const panel = document.getElementById('files-panel');
  if (!Object.keys(STATE.files).length) {
    panel.classList.remove('active');
    return;
  }
  panel.classList.add('active');
  const typeMap = { planilla: 'planilla', gc: 'gc', consumo: 'consumo' };
  const typeLabels = { planilla: 'PLANILLA DIARIA', gc: 'SALDOS GC', consumo: 'CONSUMO POR DÍA' };
  container.innerHTML = Object.entries(STATE.files).map(([name, info]) => {
    const cls = typeMap[info.tipo] || 'planilla';
    return `<div class="file-tag ${cls}">
      <span class="ft-status"></span>
      <span class="ft-name">${escapeHtml(name)}</span>
      <span class="ft-sheets">${typeLabels[info.tipo] || info.tipo} — ${info.sheets.length} hoja(s)</span>
    </div>`;
  }).join('');
}

function updateBadges() {
  document.getElementById('badge-saldos').textContent = STATE.data.saldosServicios.length;
  document.getElementById('badge-ypf').textContent = STATE.data.ypfTerrestre.length + STATE.data.ypfSuperficie.length;
  document.getElementById('badge-gc').textContent = STATE.data.gcSaldos.length;
  document.getElementById('badge-consumo').textContent = STATE.data.consumoDiario.length;
  document.getElementById('badge-simo').textContent = STATE.data.simo.length;
  document.getElementById('badge-lub').textContent = STATE.data.lubricantes.length;
}

function updateKPIs() {
  const saldoTotal = STATE.data.saldosServicios.reduce((s, r) => s + (parseFloat(r.saldo_total) || 0), 0);
  document.getElementById('kpi-saldo-total').textContent = fmtMoney(saldoTotal);

  const creditoT = STATE.data.ypfTerrestre.reduce((s, r) => s + (parseFloat(r.asignado_inicio) || 0), 0);
  const creditoS = STATE.data.ypfSuperficie.reduce((s, r) => s + (parseFloat(r.asignado_inicio) || 0), 0);
  document.getElementById('kpi-credito-terrestre').textContent = fmtMoney(creditoT);
  document.getElementById('kpi-credito-superficie').textContent = fmtMoney(creditoS);

  const consumoT = STATE.data.ypfTerrestre.reduce((s, r) => s + (parseFloat(r.consumo_actual) || 0), 0);
  const consumoS = STATE.data.ypfSuperficie.reduce((s, r) => s + (parseFloat(r.consumo_actual) || 0), 0);
  document.getElementById('kpi-consumo-acum').textContent = fmtMoney(consumoT + consumoS);

  const gcBravo = STATE.data.gcCondicion.filter(r => r.condicion === 'BRAVO').length;
  document.getElementById('kpi-gc-activos').textContent = gcBravo;

  const gcCount = STATE.data.gcSaldos.length;
  const gcTotal = STATE.data.gcSaldos.reduce((s, r) => s + (parseFloat(r.saldo_litros) || 0), 0);
  document.getElementById('kpi-saldo-gc-avg').textContent = gcCount ? fmtNumber(gcTotal / gcCount, 0) + ' L' : '0 L';

  const lubTotal = STATE.data.lubricantes.reduce((s, r) => s + (parseFloat(r.precio_total) || 0), 0);
  document.getElementById('kpi-lub-total').textContent = fmtMoney(lubTotal);
  document.getElementById('kpi-lub-items').textContent = STATE.data.lubricantes.length;
}

// ============================================
// TABS
// ============================================
function switchTab(tabName) {
  document.querySelectorAll('.nav-tab-item').forEach(t => t.classList.remove('active'));
  document.querySelectorAll('.tab-content').forEach(t => t.classList.remove('active'));
  document.querySelector(`.nav-tab-item[data-tab="${tabName}"]`).classList.add('active');
  document.getElementById('tab-' + tabName).classList.add('active');
}

// ============================================
// TABLES
// ============================================
function renderAllTables() {
  renderDataTable('saldos-servicios', STATE.data.saldosServicios, [
    { key: 'servicio', label: 'Servicio', width: '180px' },
    { key: 'saldo_informado', label: 'Saldo Informado', type: 'money' },
    { key: 'op_pendiente', label: 'OP Pendiente', width: '160px' },
    { key: 'monto_op', label: 'Monto OP', type: 'money' },
    { key: 'ff', label: 'F.F.', width: '60px', align: 'center' },
    { key: 'fecha_dispo', label: 'Fecha Dispo.', width: '110px', align: 'center' },
    { key: 'saldo_total', label: 'Saldo Total', type: 'money' }
  ]);

  renderDataTable('saldos-dtra', STATE.data.saldosDTRA, [
    { key: 'concepto', label: 'Concepto', width: '280px' },
    { key: 'saldo_actual', label: 'Saldo Actual', type: 'money' },
    { key: 'consumo', label: 'Consumo', type: 'money' },
    { key: 'prevision', label: 'Previsión Tentativa', type: 'money' }
  ], false);

  renderDataTable('ypf-terrestre', STATE.data.ypfTerrestre, [
    { key: 'n_contrato', label: 'N° Contrato', width: '100px', align: 'center' },
    { key: 'contrato', label: 'Contrato', width: '220px' },
    { key: 'asignado_inicio', label: 'Asignado Inicio', type: 'money' },
    { key: 'asignado_mes', label: 'Asignado Mes', type: 'money' },
    { key: 'consumo_actual', label: 'Consumo Actual', type: 'money' },
    { key: 'consumo_prom_dia', label: 'Cons. Prom/Día', type: 'money' },
    { key: 'saldo_actual', label: 'Saldo Actual', type: 'money' },
    { key: 'dias_restantes', label: 'Días Rest.', type: 'number', decimals: 1 },
    { key: 'diferencia', label: 'Diferencia', type: 'money' }
  ]);

  renderDataTable('ypf-superficie', STATE.data.ypfSuperficie, [
    { key: 'n_contrato', label: 'N° Contrato', width: '100px', align: 'center' },
    { key: 'contrato', label: 'Contrato', width: '220px' },
    { key: 'asignado_inicio', label: 'Asignado Inicio', type: 'money' },
    { key: 'asignado_mes', label: 'Asignado Mes', type: 'money' },
    { key: 'consumo_actual', label: 'Consumo Actual', type: 'money' },
    { key: 'consumo_prom_dia', label: 'Cons. Prom/Día', type: 'money' },
    { key: 'saldo_actual', label: 'Saldo Actual', type: 'money' },
    { key: 'dias_restantes', label: 'Días Rest.', type: 'number', decimals: 1 },
    { key: 'diferencia', label: 'Diferencia', type: 'money' }
  ]);

  renderDataTable('gc-saldos', STATE.data.gcSaldos, [
    { key: 'guardacostas', label: 'Guardacostas', width: '220px' },
    { key: 'saldo_litros', label: 'Saldo (Ltrs)', type: 'number', decimals: 0 },
    { key: 'porcentaje', label: '% Capacidad', type: 'pct' },
    { key: 'capacidad', label: 'Capacidad (Ltrs)', type: 'number', decimals: 0 },
    { key: 'consumo_dia', label: 'Cons. Ltrs/Día', type: 'number', decimals: 0 }
  ]);

  renderDataTable('gc-condicion', STATE.data.gcCondicion, [
    { key: 'guardacostas', label: 'Guardacostas', width: '220px' },
    { key: 'saldo_litros', label: 'Saldo (Ltrs)', type: 'number', decimals: 0 },
    { key: 'porcentaje', label: '% Capacidad', type: 'pct' },
    { key: 'puerto', label: 'Puerto de Asiento', width: '180px' },
    { key: 'condicion', label: 'Condición', type: 'badge' },
    { key: 'capacidad', label: 'Capacidad (Ltrs)', type: 'number', decimals: 0 },
    { key: 'consumo_dia', label: 'Cons. Ltrs/Día', type: 'number', decimals: 0 }
  ], false);

  renderConsumoDiarioTable();

  renderDataTable('simo-table', STATE.data.simo, [
    { key: 'n', label: 'N°', width: '40px', align: 'center' },
    { key: 'zona', label: 'Zona / Dirección', width: '280px' },
    { key: 'medio', label: 'Medio', width: '200px' },
    { key: 'sigla', label: 'Sigla', width: '120px' },
    { key: 'alistamiento', label: 'Alistamiento', type: 'badge', width: '100px', align: 'center' },
    { key: 'fecha', label: 'Fecha', width: '100px', align: 'center' },
    { key: 'tipo_comb', label: 'Tipo Comb.', width: '100px', align: 'center' },
    { key: 'anio', label: 'Año', width: '60px', align: 'center' }
  ]);

  renderDataTable('lub-table', STATE.data.lubricantes, [
    { key: 'cantidad', label: 'Cant.', width: '60px', align: 'center' },
    { key: 'producto', label: 'Especie del Producto', width: 'auto' },
    { key: 'precio_unitario', label: 'Precio Unitario', type: 'money' },
    { key: 'precio_total', label: 'Precio Total', type: 'money' }
  ], false);

  populateSelects();
}

function populateSelects() {
  const selContrato = document.getElementById('filter-contrato');
  if (selContrato) {
    const current = selContrato.value;
    selContrato.innerHTML = '<option value="">Todos los contratos</option>' +
      STATE.data.consumoDiario.map(c => `<option value="${escapeHtml(c.nombre)}">${escapeHtml(c.nombre)}</option>`).join('');
    selContrato.value = current;
  }
  const selTipo = document.getElementById('filter-tipo');
  if (selTipo) {
    const tipos = [...new Set(STATE.data.simo.map(s => s.medio).filter(Boolean))];
    const current = selTipo.value;
    selTipo.innerHTML = '<option value="">Todos los tipos</option>' +
      tipos.map(t => `<option value="${escapeHtml(t)}">${escapeHtml(t)}</option>`).join('');
    selTipo.value = current;
  }
}

function renderDataTable(tableId, data, columns, paginate = true) {
  const table = document.getElementById(tableId);
  if (!table) return;
  const thead = table.querySelector('thead tr');
  const tbody = table.querySelector('tbody');

  thead.innerHTML = columns.map((col, idx) => {
    const sortIcon = STATE.sort[tableId] === idx ? (STATE.sort[tableId + '_asc'] ? '▲' : '▼') : '⇅';
    const sortedClass = STATE.sort[tableId] === idx ? 'sorted' : '';
    return `<th class="${sortedClass}" onclick="sortTable('${tableId}', ${idx}, '${col.key}')" style="${col.width ? 'width:'+col.width+';' : ''}${col.align ? 'text-align:'+col.align+';' : ''}">
      ${escapeHtml(col.label)}<span class="sort-icon">${sortIcon}</span>
    </th>`;
  }).join('');

  let filtered = [...data];
  const searchInput = document.getElementById('search-' + tableId.split('-')[0]);
  if (searchInput && searchInput.value.trim()) {
    const q = searchInput.value.toLowerCase();
    filtered = filtered.filter(row => Object.values(row).some(v => String(v).toLowerCase().includes(q)));
  }

  if (tableId === 'saldos-servicios') {
    const ff = document.getElementById('filter-ff');
    if (ff && ff.value) filtered = filtered.filter(r => String(r.ff) === ff.value);
  }
  if (tableId === 'simo-table') {
    const alist = document.getElementById('filter-alistamiento');
    if (alist && alist.value) filtered = filtered.filter(r => r.alistamiento === alist.value);
    const tipo = document.getElementById('filter-tipo');
    if (tipo && tipo.value) filtered = filtered.filter(r => r.medio === tipo.value);
  }

  if (paginate) {
    const page = STATE.pagination[tableId] || 1;
    const totalPages = Math.ceil(filtered.length / ROWS_PER_PAGE) || 1;
    const start = (page - 1) * ROWS_PER_PAGE;
    const pageData = filtered.slice(start, start + ROWS_PER_PAGE);

    tbody.innerHTML = pageData.map(row => `<tr>${columns.map(col => {
      let val = row[col.key];
      let cls = '';
      let content = '';
      if (col.type === 'money') {
        cls = 'cell-money';
        const num = parseFloat(val);
        if (!isNaN(num) && num < 0) cls += ' negative';
        content = fmtMoney(val);
      } else if (col.type === 'number') {
        content = fmtNumber(val, col.decimals || 0);
      } else if (col.type === 'pct') {
        const num = parseFloat(val) || 0;
        let barClass = num > 60 ? 'high' : num > 30 ? 'medium' : 'low';
        content = `<div class="pct-bar"><div class="pct-bar-track"><div class="pct-bar-fill ${barClass}" style="width:${Math.min(num,100)}%"></div></div><span class="pct-bar-text">${fmtNumber(num, 1)}%</span></div>`;
      } else if (col.type === 'badge') {
        content = `<span class="badge-custom badge-${String(val).toLowerCase().replace(/\s/g, '-')}">${escapeHtml(val || '-')}</span>`;
      } else {
        content = escapeHtml(val ?? '-');
      }
      return `<td class="${cls}" style="${col.align ? 'text-align:'+col.align+';' : ''}">${content}</td>`;
    }).join('')}</tr>`).join('') || '<tr><td colspan="' + columns.length + '" style="text-align:center;padding:40px;color:#5a6a82;">Sin datos</td></tr>';

    const pagId = 'pagination-' + tableId.split('-').slice(0, 2).join('-');
    const pagEl = document.getElementById(pagId);
    if (pagEl) {
      pagEl.innerHTML = `
        <span class="pagination-info">Mostrando ${Math.min(filtered.length, start + 1)}–${Math.min(filtered.length, start + ROWS_PER_PAGE)} de ${filtered.length}</span>
        <div class="pagination-btns">
          <button onclick="goPage('${tableId}', ${page - 1})" ${page <= 1 ? 'disabled' : ''}>◀ Anterior</button>
          <span class="page-num">Página ${page} de ${totalPages}</span>
          <button onclick="goPage('${tableId}', ${page + 1})" ${page >= totalPages ? 'disabled' : ''}>Siguiente ▶</button>
        </div>`;
    }
  } else {
    tbody.innerHTML = filtered.map(row => `<tr>${columns.map(col => {
      let val = row[col.key];
      let cls = '';
      let content = '';
      if (col.type === 'money') { cls = 'cell-money'; if (parseFloat(val) < 0) cls += ' negative'; content = fmtMoney(val); }
      else if (col.type === 'number') { content = fmtNumber(val, col.decimals || 0); }
      else if (col.type === 'pct') {
        const num = parseFloat(val) || 0;
        let barClass = num > 60 ? 'high' : num > 30 ? 'medium' : 'low';
        content = `<div class="pct-bar"><div class="pct-bar-track"><div class="pct-bar-fill ${barClass}" style="width:${Math.min(num,100)}%"></div></div><span class="pct-bar-text">${fmtNumber(num, 1)}%</span></div>`;
      }
      else if (col.type === 'badge') { content = `<span class="badge-custom badge-${String(val).toLowerCase().replace(/\s/g,'-')}">${escapeHtml(val||'-')}</span>`; }
      else { content = escapeHtml(val ?? '-'); }
      return `<td class="${cls}" style="${col.align ? 'text-align:'+col.align+';' : ''}">${content}</td>`;
    }).join('')}</tr>`).join('') || '<tr><td colspan="' + columns.length + '" style="text-align:center;padding:40px;color:#5a6a82;">Sin datos</td></tr>';
  }
}

function renderConsumoDiarioTable() {
  const table = document.getElementById('consumo-diario');
  if (!table || !STATE.data.consumoDiario.length) {
    if (table) table.querySelector('tbody').innerHTML = '<tr><td style="text-align:center;padding:40px;color:#5a6a82;">Cargue el archivo de Consumo por Día</td></tr>';
    return;
  }
  const fechas = STATE.data.consumoDiario[0].fechas;
  const thead = table.querySelector('thead tr');
  const tbody = table.querySelector('tbody');

  let headersHTML = '<th>Contrato</th><th>N°</th><th>Estado</th><th>Límite Crédito</th>';
  fechas.forEach(f => { headersHTML += `<th>Cons. ${f}</th>`; });
  headersHTML += '<th>Total Consumo</th>';
  thead.innerHTML = headersHTML;

  let filtered = [...STATE.data.consumoDiario];
  const search = document.getElementById('search-consumo');
  if (search && search.value.trim()) {
    const q = search.value.toLowerCase();
    filtered = filtered.filter(r => r.nombre.toLowerCase().includes(q) || String(r.n_contrato).toLowerCase().includes(q));
  }
  const selContrato = document.getElementById('filter-contrato');
  if (selContrato && selContrato.value) filtered = filtered.filter(r => r.nombre === selContrato.value);

  const tableId = 'consumo-diario';
  const page = STATE.pagination[tableId] || 1;
  const totalPages = Math.ceil(filtered.length / ROWS_PER_PAGE) || 1;
  const start = (page - 1) * ROWS_PER_PAGE;
  const pageData = filtered.slice(start, start + ROWS_PER_PAGE);

  tbody.innerHTML = pageData.map(row => {
    const totalCons = row.consumos.reduce((s, v) => s + (parseFloat(v) || 0), 0);
    let html = `<td><strong>${escapeHtml(row.nombre)}</strong></td>`;
    html += `<td>${escapeHtml(row.n_contrato)}</td>`;
    html += `<td><span class="badge-custom badge-activo">${escapeHtml(row.estado)}</span></td>`;
    html += `<td class="cell-money">${fmtMoney(row.limite_credito)}</td>`;
    row.consumos.forEach(c => {
      const num = parseFloat(c) || 0;
      html += `<td class="cell-money ${num < 0 ? 'negative' : ''}">${fmtMoney(c)}</td>`;
    });
    html += `<td class="cell-money">${fmtMoney(totalCons)}</td>`;
    return `<tr>${html}</tr>`;
  }).join('');

  const pagEl = document.getElementById('pagination-consumo');
  if (pagEl) {
    pagEl.innerHTML = `
      <span class="pagination-info">Mostrando ${Math.min(filtered.length, start + 1)}–${Math.min(filtered.length, start + ROWS_PER_PAGE)} de ${filtered.length}</span>
      <div class="pagination-btns">
        <button onclick="goPage('${tableId}', ${page - 1})" ${page <= 1 ? 'disabled' : ''}>◀ Anterior</button>
        <span class="page-num">Página ${page} de ${totalPages}</span>
        <button onclick="goPage('${tableId}', ${page + 1})" ${page >= totalPages ? 'disabled' : ''}>Siguiente ▶</button>
      </div>`;
  }
}

function goPage(tableId, page) {
  if (page < 1) return;
  STATE.pagination[tableId] = page;
  if (tableId === 'consumo-diario') renderConsumoDiarioTable();
  else renderAllTables();
}

function sortTable(tableId, colIdx, key) {
  const dataKey = getDataKeyForTable(tableId);
  if (!dataKey) return;
  const asc = STATE.sort[tableId] === colIdx ? !STATE.sort[tableId + '_asc'] : true;
  STATE.sort[tableId] = colIdx;
  STATE.sort[tableId + '_asc'] = asc;
  STATE.data[dataKey].sort((a, b) => {
    let va = a[key], vb = b[key];
    const na = parseFloat(va), nb = parseFloat(vb);
    if (!isNaN(na) && !isNaN(nb)) return asc ? na - nb : nb - na;
    va = String(va || '').toLowerCase();
    vb = String(vb || '').toLowerCase();
    if (va < vb) return asc ? -1 : 1;
    if (va > vb) return asc ? 1 : -1;
    return 0;
  });
  STATE.pagination[tableId] = 1;
  renderAllTables();
}

function getDataKeyForTable(tableId) {
  const map = {
    'saldos-servicios': 'saldosServicios',
    'saldos-dtra': 'saldosDTRA',
    'ypf-terrestre': 'ypfTerrestre',
    'ypf-superficie': 'ypfSuperficie',
    'gc-saldos': 'gcSaldos',
    'gc-condicion': 'gcCondicion',
    'simo-table': 'simo',
    'lub-table': 'lubricantes'
  };
  return map[tableId];
}

function filterTable(tableId) {
  STATE.pagination[tableId] = 1;
  if (tableId === 'consumo-diario') renderConsumoDiarioTable();
  else renderAllTables();
}

// ============================================
// CHARTS
// ============================================
function renderAllCharts() {
  destroyCharts();
  Chart.defaults.color = '#8b9bb4';
  Chart.defaults.borderColor = 'rgba(255,255,255,0.08)';
  Chart.defaults.font.family = 'Inter, sans-serif';

  // 1. Saldos Pie
  if (STATE.data.saldosServicios.length) {
    const ctx = document.getElementById('chart-saldos-pie');
    if (ctx) {
      STATE.charts.saldosPie = new Chart(ctx, {
        type: 'doughnut',
        data: {
          labels: STATE.data.saldosServicios.map(s => s.servicio),
          datasets: [{
            data: STATE.data.saldosServicios.map(s => s.saldo_total),
            backgroundColor: ['#00d4ff', '#00e676', '#ffab00', '#ff5252'],
            borderWidth: 0,
            hoverOffset: 8
          }]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          cutout: '65%',
          plugins: {
            legend: { position: 'bottom', labels: { padding: 20, usePointStyle: true, pointStyle: 'circle' } },
            tooltip: {
              backgroundColor: 'rgba(10,22,40,0.9)',
              titleColor: '#00d4ff',
              bodyColor: '#e8ecf1',
              borderColor: 'rgba(0,212,255,0.2)',
              borderWidth: 1,
              padding: 12,
              callbacks: {
                label: function(ctx) {
                  const val = ctx.raw;
                  const total = ctx.dataset.data.reduce((a, b) => a + b, 0);
                  const pct = ((val / total) * 100).toFixed(1);
                  return ` ${ctx.label}: ${fmtMoney(val)} (${pct}%)`;
                }
              }
            }
          }
        }
      });
    }
  }

  // 2. Consumo Line
  if (STATE.data.consumoDiario.length) {
    const ctx = document.getElementById('chart-consumo-line');
    if (ctx) {
      const fechas = STATE.data.consumoDiario[0].fechas;
      const colors = ['#00d4ff', '#00e676', '#ffab00', '#ff5252', '#b388ff', '#ff6e40'];
      STATE.charts.consumoLine = new Chart(ctx, {
        type: 'line',
        data: {
          labels: fechas,
          datasets: STATE.data.consumoDiario.map((c, idx) => ({
            label: c.nombre,
            data: c.consumos,
            borderColor: colors[idx % colors.length],
            backgroundColor: colors[idx % colors.length] + '20',
            fill: false,
            tension: 0.4,
            pointRadius: 5,
            pointHoverRadius: 8,
            pointBackgroundColor: colors[idx % colors.length],
            pointBorderColor: '#0a1628',
            pointBorderWidth: 2,
            borderWidth: 2.5
          }))
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          interaction: { mode: 'index', intersect: false },
          plugins: {
            legend: { position: 'bottom', labels: { padding: 15, usePointStyle: true } },
            tooltip: {
              backgroundColor: 'rgba(10,22,40,0.9)',
              titleColor: '#00d4ff',
              bodyColor: '#e8ecf1',
              borderColor: 'rgba(0,212,255,0.2)',
              borderWidth: 1,
              padding: 12,
              callbacks: { label: function(ctx) { return ` ${ctx.dataset.label}: ${fmtMoney(ctx.raw)}`; } }
            }
          },
          scales: {
            y: { grid: { color: 'rgba(255,255,255,0.05)' }, ticks: { callback: function(v) { return fmtMoney(v); } } },
            x: { grid: { display: false } }
          }
        }
      });
    }
  }

  // 3. YPF Bar
  if (STATE.data.ypfTerrestre.length) {
    const ctx = document.getElementById('chart-ypf-bar');
    if (ctx) {
      STATE.charts.ypfBar = new Chart(ctx, {
        type: 'bar',
        data: {
          labels: STATE.data.ypfTerrestre.map(r => r.contrato.replace('DIRECCION DE ', '').replace('DIRECCIÓN DE ', '')),
          datasets: [
            { label: 'Asignado', data: STATE.data.ypfTerrestre.map(r => r.asignado_inicio), backgroundColor: '#00d4ff', borderRadius: 4 },
            { label: 'Consumo', data: STATE.data.ypfTerrestre.map(r => r.consumo_actual), backgroundColor: '#ff5252', borderRadius: 4 },
            { label: 'Saldo', data: STATE.data.ypfTerrestre.map(r => r.saldo_actual), backgroundColor: '#00e676', borderRadius: 4 }
          ]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: {
            legend: { position: 'bottom', labels: { padding: 15, usePointStyle: true } },
            tooltip: {
              backgroundColor: 'rgba(10,22,40,0.9)',
              titleColor: '#00d4ff',
              bodyColor: '#e8ecf1',
              borderColor: 'rgba(0,212,255,0.2)',
              borderWidth: 1,
              padding: 12,
              callbacks: { label: function(ctx) { return ` ${ctx.dataset.label}: ${fmtMoney(ctx.raw)}`; } }
            }
          },
          scales: {
            y: { grid: { color: 'rgba(255,255,255,0.05)' }, ticks: { callback: function(v) { return fmtMoney(v); } } },
            x: { grid: { display: false } }
          }
        }
      });
    }
  }

  // 4. GC Levels
  if (STATE.data.gcSaldos.length) {
    const ctx = document.getElementById('chart-gc-levels');
    if (ctx) {
      STATE.charts.gcLevels = new Chart(ctx, {
        type: 'bar',
        data: {
          labels: STATE.data.gcSaldos.map(r => r.guardacostas.split('"')[1] || r.guardacostas),
          datasets: [{
            label: '% Capacidad',
            data: STATE.data.gcSaldos.map(r => r.porcentaje),
            backgroundColor: STATE.data.gcSaldos.map(r => {
              const p = parseFloat(r.porcentaje) || 0;
              return p > 60 ? '#00e676' : p > 30 ? '#ffab00' : '#ff5252';
            }),
            borderRadius: 4,
            barThickness: 20
          }]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          indexAxis: 'y',
          plugins: {
            legend: { display: false },
            tooltip: {
              backgroundColor: 'rgba(10,22,40,0.9)',
              titleColor: '#00d4ff',
              bodyColor: '#e8ecf1',
              borderColor: 'rgba(0,212,255,0.2)',
              borderWidth: 1,
              padding: 12,
              callbacks: { label: function(ctx) { return ` ${ctx.raw.toFixed(1)}%`; } }
            }
          },
          scales: {
            x: { max: 100, grid: { color: 'rgba(255,255,255,0.05)' }, ticks: { callback: function(v) { return v + '%'; } } },
            y: { grid: { display: false } }
          }
        }
      });
    }
  }

  // 5. Limite Evolution
  if (STATE.data.consumoDiario.length) {
    const ctx = document.getElementById('chart-limite-evol');
    if (ctx) {
      const fechas = STATE.data.consumoDiario[0].fechas;
      const colors = ['#00d4ff', '#00e676', '#ffab00', '#ff5252', '#b388ff', '#ff6e40'];
      STATE.charts.limiteEvol = new Chart(ctx, {
        type: 'line',
        data: {
          labels: fechas,
          datasets: STATE.data.consumoDiario.map((c, idx) => ({
            label: c.nombre,
            data: c.limites,
            borderColor: colors[idx % colors.length],
            fill: false,
            tension: 0.4,
            pointRadius: 5,
            pointHoverRadius: 8,
            pointBackgroundColor: colors[idx % colors.length],
            pointBorderColor: '#0a1628',
            pointBorderWidth: 2,
            borderWidth: 2.5
          }))
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          interaction: { mode: 'index', intersect: false },
          plugins: {
            legend: { position: 'bottom', labels: { padding: 15, usePointStyle: true } },
            tooltip: {
              backgroundColor: 'rgba(10,22,40,0.9)',
              titleColor: '#00d4ff',
              bodyColor: '#e8ecf1',
              borderColor: 'rgba(0,212,255,0.2)',
              borderWidth: 1,
              padding: 12,
              callbacks: { label: function(ctx) { return ` ${ctx.dataset.label}: ${fmtMoney(ctx.raw)}`; } }
            }
          },
          scales: {
            y: { grid: { color: 'rgba(255,255,255,0.05)' }, ticks: { callback: function(v) { return fmtMoney(v); } } },
            x: { grid: { display: false } }
          }
        }
      });
    }
  }

  // 6. Consumo Evolution
  if (STATE.data.consumoDiario.length) {
    const ctx = document.getElementById('chart-consumo-evol');
    if (ctx) {
      const fechas = STATE.data.consumoDiario[0].fechas;
      const colors = ['#00d4ff', '#00e676', '#ffab00', '#ff5252', '#b388ff', '#ff6e40'];
      STATE.charts.consumoEvol = new Chart(ctx, {
        type: 'bar',
        data: {
          labels: fechas,
          datasets: STATE.data.consumoDiario.map((c, idx) => ({
            label: c.nombre,
            data: c.consumos,
            backgroundColor: colors[idx % colors.length] + '80',
            borderColor: colors[idx % colors.length],
            borderWidth: 1,
            borderRadius: 3
          }))
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: {
            legend: { position: 'bottom', labels: { padding: 15, usePointStyle: true } },
            tooltip: {
              backgroundColor: 'rgba(10,22,40,0.9)',
              titleColor: '#00d4ff',
              bodyColor: '#e8ecf1',
              borderColor: 'rgba(0,212,255,0.2)',
              borderWidth: 1,
              padding: 12,
              callbacks: { label: function(ctx) { return ` ${ctx.dataset.label}: ${fmtMoney(ctx.raw)}`; } }
            }
          },
          scales: {
            y: { grid: { color: 'rgba(255,255,255,0.05)' }, ticks: { callback: function(v) { return fmtMoney(v); } } },
            x: { grid: { display: false } }
          }
        }
      });
    }
  }

  // 7. SIMO Condicion
  if (STATE.data.simo.length) {
    const ctx = document.getElementById('chart-simo-condicion');
    if (ctx) {
      const counts = {};
      STATE.data.simo.forEach(s => { counts[s.alistamiento] = (counts[s.alistamiento] || 0) + 1; });
      STATE.charts.simoCond = new Chart(ctx, {
        type: 'doughnut',
        data: {
          labels: Object.keys(counts),
          datasets: [{
            data: Object.values(counts),
            backgroundColor: ['#00e676', '#ffab00', '#ff5252'],
            borderWidth: 0,
            hoverOffset: 8
          }]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          cutout: '60%',
          plugins: {
            legend: { position: 'right', labels: { padding: 20, usePointStyle: true } },
            tooltip: {
              backgroundColor: 'rgba(10,22,40,0.9)',
              titleColor: '#00d4ff',
              bodyColor: '#e8ecf1',
              borderColor: 'rgba(0,212,255,0.2)',
              borderWidth: 1,
              padding: 12,
              callbacks: {
                label: function(ctx) {
                  const total = ctx.dataset.data.reduce((a, b) => a + b, 0);
                  const pct = ((ctx.raw / total) * 100).toFixed(1);
                  return ` ${ctx.label}: ${ctx.raw} unidades (${pct}%)`;
                }
              }
            }
          }
        }
      });
    }
  }
}

function destroyCharts() {
  Object.values(STATE.charts).forEach(c => { if (c) c.destroy(); });
  STATE.charts = {};
}

// ============================================
// EXPORT
// ============================================
function exportTable(tableId) {
  const table = document.getElementById(tableId);
  if (!table) return;
  let csv = '';
  const rows = table.querySelectorAll('tr');
  rows.forEach(row => {
    const cells = row.querySelectorAll('th, td');
    const line = Array.from(cells).map(c => {
      let text = c.textContent.trim().replace(/"/g, '""');
      if (text.includes(',') || text.includes('"')) text = '"' + text + '"';
      return text;
    }).join(',');
    csv += line + '\n';
  });
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = tableId + '_' + new Date().toISOString().slice(0,10) + '.csv';
  link.click();
}

function downloadReport() {
  let csv = 'REPORTE CONSOLIDADO - PREFECTURA NAVAL ARGENTINA\n';
  csv += 'Generado: ' + new Date().toLocaleString('es-AR') + '\n\n';
  ['saldos-servicios', 'saldos-dtra', 'ypf-terrestre', 'ypf-superficie', 'gc-saldos', 'gc-condicion', 'simo-table', 'lub-table'].forEach(id => {
    const table = document.getElementById(id);
    if (!table) return;
    csv += '\n=== ' + id.toUpperCase().replace(/-/g, ' ') + ' ===\n';
    const rows = table.querySelectorAll('tr');
    rows.forEach(row => {
      const cells = row.querySelectorAll('th, td');
      const line = Array.from(cells).map(c => {
        let text = c.textContent.trim().replace(/"/g, '""');
        if (text.includes(',') || text.includes('"')) text = '"' + text + '"';
        return text;
      }).join(',');
      csv += line + '\n';
    });
  });
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = 'reporte_combustibles_' + new Date().toISOString().slice(0,10) + '.csv';
  link.click();
}

function clearAllData() {
  STATE.files = {};
  STATE.data = {
    saldosServicios: [], saldosDTRA: [], ypfTerrestre: [], ypfSuperficie: [],
    gcSaldos: [], gcCondicion: [], consumoDiario: [], simo: [], lubricantes: []
  };
  STATE.pagination = {};
  STATE.sort = {};
  destroyCharts();
  document.getElementById('files-panel').classList.remove('active');
  document.getElementById('file-input').value = '';
  updateBadges();
  updateKPIs();
  renderAllTables();
  renderAllCharts();
  showAlert('success', 'Todos los datos han sido limpiados');
}

// Inicializar sesión al cargar
document.addEventListener('DOMContentLoaded', async () => {
  await checkSession();
});
