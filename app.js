// app.js - Lógica de login y dashboard de socios

const API_BASE = window.location.origin;

// Verificar si ya hay sesión activa
const token = localStorage.getItem('socio_token');
if (token && window.location.pathname.includes('index.html')) {
  window.location.href = '/dashboard.html';
}

// ============= PÁGINA DE LOGIN =============
if (document.getElementById('loginForm')) {
  // Tabs
  const tabs = document.querySelectorAll('.tab-btn');
  const loginPanel = document.getElementById('loginForm');
  const registerPanel = document.getElementById('registerForm');

  tabs.forEach(tab => {
    tab.addEventListener('click', () => {
      tabs.forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      
      if (tab.dataset.tab === 'login') {
        loginPanel.classList.remove('form-hidden');
        registerPanel.classList.add('form-hidden');
      } else {
        loginPanel.classList.add('form-hidden');
        registerPanel.classList.remove('form-hidden');
      }
    });
  });

  // Login
  document.getElementById('btnLogin').addEventListener('click', async () => {
    const email = document.getElementById('loginEmail').value.trim();
    const password = document.getElementById('loginPassword').value;
    const msgDiv = document.getElementById('loginMessage');

    if (!email || !password) {
      msgDiv.className = 'message error';
      msgDiv.textContent = '⚠️ Completa todos los campos';
      return;
    }

    msgDiv.className = 'message';
    msgDiv.textContent = '⏳ Iniciando sesión...';
    msgDiv.style.display = 'block';

    try {
      const res = await fetch(`${API_BASE}/api/socios/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password })
      });

      const data = await res.json();

      if (!data.ok) {
        throw new Error(data.error || 'Error al iniciar sesión');
      }

      localStorage.setItem('socio_token', data.token);
      localStorage.setItem('socio_data', JSON.stringify(data.socio));

      msgDiv.className = 'message success';
      msgDiv.textContent = '✅ Sesión iniciada. Redirigiendo...';
      
      setTimeout(() => {
        window.location.href = '/dashboard.html';
      }, 1000);

    } catch (error) {
      msgDiv.className = 'message error';
      msgDiv.textContent = `❌ ${error.message}`;
    }
  });

  

  // Registro
  document.getElementById('btnRegister').addEventListener('click', async () => {
    const nombre = document.getElementById('regNombre').value.trim();
    const email = document.getElementById('regEmail').value.trim();
    const telefono = document.getElementById('regTelefono').value.trim();
    const password = document.getElementById('regPassword').value;
    const confirm = document.getElementById('regConfirmPassword').value;
    const msgDiv = document.getElementById('registerMessage');

    if (!nombre || !email || !telefono || !password) {
      msgDiv.className = 'message error';
      msgDiv.textContent = '⚠️ Completa todos los campos';
      return;
    }

    if (password !== confirm) {
      msgDiv.className = 'message error';
      msgDiv.textContent = '⚠️ Las contraseñas no coinciden';
      return;
    }

    if (!/^\d{8,15}$/.test(telefono.replace(/\D/g, ''))) {
      msgDiv.className = 'message error';
      msgDiv.textContent = '⚠️ Teléfono inválido (solo números, 8-15 dígitos)';
      return;
    }

    msgDiv.className = 'message';
    msgDiv.textContent = '⏳ Creando cuenta...';
    msgDiv.style.display = 'block';

    try {
      const res = await fetch(`${API_BASE}/api/socios/registro`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ nombre, email, telefono, password })
      });

      const data = await res.json();

      if (!data.ok) {
        throw new Error(data.error || 'Error al registrar');
      }

      msgDiv.className = 'message success';
      msgDiv.textContent = '✅ Cuenta creada. Ya puedes iniciar sesión';
      
      document.getElementById('regNombre').value = '';
      document.getElementById('regEmail').value = '';
      document.getElementById('regTelefono').value = '';
      document.getElementById('regPassword').value = '';
      document.getElementById('regConfirmPassword').value = '';
      
      document.querySelector('.tab-btn[data-tab="login"]').click();

    } catch (error) {
      msgDiv.className = 'message error';
      msgDiv.textContent = `❌ ${error.message}`;
    }
  });
}

// ============= DASHBOARD =============
if (document.getElementById('dashboard-container') || document.querySelector('.dashboard-header')) {
  
  const token = localStorage.getItem('socio_token');
  if (!token) {
    window.location.href = '/index.html';
  }

  let socioData = JSON.parse(localStorage.getItem('socio_data') || '{}');
  
  if (socioData.nombre) {
    document.getElementById('welcomeTitle').textContent = `Bienvenido, ${socioData.nombre}`;
    document.getElementById('userName').textContent = socioData.nombre;
    
    const estrellas = socioData.estrellas || 0;
    const estrellasLlenas = '★'.repeat(Math.floor(estrellas));
    const estrellasVacias = '☆'.repeat(5 - Math.floor(estrellas));
    document.getElementById('userStars').innerHTML = estrellasLlenas + estrellasVacias;
  }

  // Mostrar token
  const tokenActual = localStorage.getItem('socio_token');
  const tokenDisplay = document.getElementById('userTokenDisplay');
  if (tokenDisplay && tokenActual) {
    const tokenFormateado = tokenActual.replace(/(\d{3})/g, '$1 ').trim();
    tokenDisplay.textContent = tokenFormateado;
  }

  // ============= FOTO DE PERFIL =============
  const avatarImg = document.getElementById('avatarImg');
  const avatarWrapper = document.querySelector('.avatar-wrapper');
  
  const fileInput = document.createElement('input');
  fileInput.type = 'file';
  fileInput.accept = 'image/*';
  fileInput.style.display = 'none';
  document.body.appendChild(fileInput);

  if (avatarWrapper) {
    avatarWrapper.addEventListener('click', () => {
      fileInput.click();
    });
  }

  fileInput.addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onloadend = async () => {
      const base64 = reader.result;
      
      const res = await fetch(`${API_BASE}/api/socios/foto`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ foto_base64: base64 })
      });
      
      const data = await res.json();
      if (data.ok) {
        avatarImg.src = base64;
        alert('✅ Foto de perfil actualizada');
      } else {
        alert('Error: ' + data.error);
      }
    };
    reader.readAsDataURL(file);
  });

  async function cargarFoto() {
    try {
      const res = await fetch(`${API_BASE}/api/socios/foto`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      const data = await res.json();
      if (data.ok && data.foto_base64) {
        avatarImg.src = data.foto_base64;
      }
    } catch (e) {
      console.error('Error cargando foto:', e);
    }
  }
  cargarFoto();

  // ============= QR BOT =============
  const btnMostrarQR = document.getElementById('btnMostrarQR');
  const modalQR = document.getElementById('modalQR');
  const btnCerrarQR = document.getElementById('btnCerrarQR');
  const qrImagenGrande = document.getElementById('qrImagenGrande');
  const botLinkGrande = document.getElementById('botLinkGrande');
  
  const botURL = "https://t.me/Matchsociobot";
  const qrURL = `https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=${encodeURIComponent(botURL)}`;
  
  if (btnMostrarQR) {
    btnMostrarQR.addEventListener('click', () => {
      qrImagenGrande.src = qrURL;
      botLinkGrande.href = botURL;
      modalQR.style.display = 'flex';
    });
  }
  
  if (btnCerrarQR) {
    btnCerrarQR.addEventListener('click', () => {
      modalQR.style.display = 'none';
    });
  }
  
  if (modalQR) {
    modalQR.addEventListener('click', (e) => {
      if (e.target === modalQR) {
        modalQR.style.display = 'none';
      }
    });
  }

    // Botón Lugares de verificación
  const btnLugares = document.getElementById('btnLugaresVerificacion');
  if (btnLugares) {
    btnLugares.addEventListener('click', () => {
      alert('📍 Estación de Policía\nLat: 9.9281, Lng: -84.0907\nRadio: 20 metros');
    });
  }

  // ============= DASHBOARD DATA =============
  async function cargarDashboard() {
    try {
      const res = await fetch(`${API_BASE}/api/socios/dashboard`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      const data = await res.json();
      
      if (data.ok) {
        document.getElementById('statProducts').textContent = data.stats.total_products || 0;
        document.getElementById('statSold').textContent = data.stats.sold_products || 0;
        document.getElementById('statRating').textContent = (data.stats.promedio_estrellas || 0).toFixed(1);
        renderProducts(data.products || []);
      }
    } catch (error) {
      console.error('Error cargando dashboard:', error);
    }
  }

  function renderProducts(products) {
    const container = document.getElementById('productsContainer');
    if (!container) return;
    
    if (!products.length) {
      container.innerHTML = '<div class="empty-state">📭 Aún no has subido productos</div>';
      return;
    }
    
    container.innerHTML = products.map(p => `
      <div class="product-card">
        <div class="product-img">
          ${p.foto_base64 ? `<img src="${p.foto_base64}" alt="${p.descripcion}">` : '📷 Sin imagen'}
        </div>
        <div class="product-info">
          <h4>${p.descripcion.substring(0, 50)}${p.descripcion.length > 50 ? '...' : ''}</h4>
          <div class="price">₡${parseFloat(p.precio).toLocaleString('es-CR')}</div>
          <span class="product-status ${p.estado === 'vendido' ? 'status-sold' : 'status-published'}">
            ${p.estado === 'vendido' ? '✅ Vendido' : '📢 Publicado'}
          </span>
        </div>
      </div>
    `).join('');
  }

  // Cerrar sesión
  document.getElementById('btnLogout')?.addEventListener('click', () => {
    localStorage.removeItem('socio_token');
    localStorage.removeItem('socio_data');
    window.location.href = '/index.html';
  });

  // Actualizar estrellas desde el servidor
    async function actualizarEstrellas() {
    try {
      const res = await fetch(`${API_BASE}/api/socios/estrellas`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      const data = await res.json();
      if (data.ok) {
        const estrellas = data.estrellas || 0;
        const estrellasLlenas = '★'.repeat(Math.floor(estrellas));
        const estrellasVacias = '☆'.repeat(5 - Math.floor(estrellas));
        document.getElementById('userStars').innerHTML = estrellasLlenas + estrellasVacias;
        document.getElementById('statRating').textContent = estrellas.toFixed(1);
      }
    } catch (e) {
      console.error('Error actualizando estrellas:', e);
    }
  }
  
  cargarDashboard();
    // Actualizar estrellas después de cargar el dashboard
  setTimeout(async () => {
    try {
      const res = await fetch(`${API_BASE}/api/socios/estrellas`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      const data = await res.json();
      if (data.ok) {
        const estrellas = data.estrellas || 0;
        const estrellasLlenas = '★'.repeat(Math.floor(estrellas));
        const estrellasVacias = '☆'.repeat(5 - Math.floor(estrellas));
        document.getElementById('userStars').innerHTML = estrellasLlenas + estrellasVacias;
        document.getElementById('statRating').textContent = estrellas.toFixed(1);
      }
    } catch (e) {
      console.error('Error:', e);
    }
  }, 500);
  actualizarEstrellas();
}