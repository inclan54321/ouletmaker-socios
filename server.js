require("dotenv").config();
const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { pool, ensureSchema } = require("./db");

ensureSchema().catch(() => {});

const PORT = process.env.PORT || 8080;

function sendJson(res, code, obj) {
  res.writeHead(code, { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" });
  res.end(JSON.stringify(obj));
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let raw = "";
    req.on("data", (chunk) => { raw += chunk; });
    req.on("end", () => {
      try {
        resolve(raw ? JSON.parse(raw) : {});
      } catch {
        reject(new Error("Invalid JSON"));
      }
    });
  });
}

function generarCodigo5() {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  let code = "";
  for (let i = 0; i < 5; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return code;
}

const server = http.createServer(async (req, res) => {
  // CORS para todas las respuestas
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }

  console.log(`${req.method} ${req.url}`);

  // ============= ENDPOINTS PARA SOCIOS =============

  // Registro de socio
  if (req.method === "POST" && req.url === "/api/socios/registro") {
    try {
      const body = await readJsonBody(req);
      const { nombre, email, telefono, password } = body;
      
      if (!nombre || !email || !telefono || !password) {
        return sendJson(res, 400, { ok: false, error: "Faltan campos" });
      }
      
      const password_hash = crypto.createHash("sha256").update(password).digest("hex");
      const codigo_match = generarCodigo5();
      
      await pool.query(
        `INSERT INTO socios (id, nombre, email, telefono, password_hash, codigo_match)
         VALUES (gen_random_uuid(), $1, $2, $3, $4, $5)`,
        [nombre, email, telefono, password_hash, codigo_match]
      );
      
      sendJson(res, 200, { ok: true, mensaje: "Socio registrado", codigo_match });
    } catch (e) {
      sendJson(res, 500, { ok: false, error: e.message });
    }
    return;
  }

// Login de socio
if (req.method === "POST" && req.url === "/api/socios/login") {
  try {
    const body = await readJsonBody(req);
    const { email, password } = body;
    
    const password_hash = crypto.createHash("sha256").update(password).digest("hex");
    
    const result = await pool.query(
      `SELECT id, nombre, email, telefono, codigo_match, estrellas, total_calificaciones
       FROM socios WHERE email = $1 AND password_hash = $2`,
      [email, password_hash]
    );
    
    if (result.rows.length === 0) {
      return sendJson(res, 401, { ok: false, error: "Email o contraseña incorrectos" });
    }
    
    const socio = result.rows[0];
    
    // Token de 8 dígitos
    const token = Math.floor(10000000 + Math.random() * 90000000).toString();
    
    // Expira hoy a las 23:59:59
    const expira = new Date();
    expira.setHours(23, 59, 59, 999);
    
    await pool.query(
      `UPDATE socios SET token_sesion = $1, token_expira = $2 WHERE id = $3`,
      [token, expira, socio.id]
    );
    
    sendJson(res, 200, { ok: true, token, socio });
  } catch (e) {
    console.error("Error en login:", e);
    sendJson(res, 500, { ok: false, error: e.message });
  }
  return;
}

  // Verificar token
  if (req.method === "GET" && req.url === "/api/socios/verificar") {
    const token = req.headers.authorization?.replace("Bearer ", "");
    if (!token) return sendJson(res, 401, { ok: false, error: "Token requerido" });
    
    const result = await pool.query(
      `SELECT id, nombre, email, codigo_match, estrellas FROM socios 
       WHERE token_sesion = $1 AND token_expira > NOW()`,
      [token]
    );
    
    if (result.rows.length === 0) {
      return sendJson(res, 401, { ok: false, error: "Token inválido o expirado" });
    }
    
    sendJson(res, 200, { ok: true, socio: result.rows[0] });
    return;
  }

  // Dashboard del socio
  if (req.method === "GET" && req.url === "/api/socios/dashboard") {
    const token = req.headers.authorization?.replace("Bearer ", "");
    if (!token) return sendJson(res, 401, { ok: false, error: "Token requerido" });
    
    const socioResult = await pool.query(
      `SELECT id FROM socios WHERE token_sesion = $1 AND token_expira > NOW()`,
      [token]
    );
    
    if (socioResult.rows.length === 0) {
      return sendJson(res, 401, { ok: false, error: "Token inválido" });
    }
    
    const socioId = socioResult.rows[0].id;
    
    // Obtener productos del socio
    const productsResult = await pool.query(
      `SELECT data FROM productos_socios WHERE socio_id = $1 AND estado = 'vendido' ORDER BY created_at DESC`,
      [socioId]
    );
    
    sendJson(res, 200, { 
      ok: true, 
      stats: { total_products: productsResult.rows.length, sold_products: 0, promedio_estrellas: 0 },
      products: productsResult.rows.map(r => r.data)
    });
    return;
  }

  // Subir producto
  if (req.method === "POST" && req.url === "/api/socios/producto") {
    const token = req.headers.authorization?.replace("Bearer ", "");
    if (!token) return sendJson(res, 401, { ok: false, error: "Token requerido" });
    
    try {
      const body = await readJsonBody(req);
      const { foto_base64, descripcion, precio, categoria } = body;
      
      const socioResult = await pool.query(
        `SELECT id FROM socios WHERE token_sesion = $1 AND token_expira > NOW()`,
        [token]
      );
      
      if (socioResult.rows.length === 0) {
        return sendJson(res, 401, { ok: false, error: "Token inválido" });
      }
      
      const socioId = socioResult.rows[0].id;
      const productId = crypto.randomUUID();
      
      // Guardar producto
      const productData = {
        id: productId,
        socio_id: socioId,
        descripcion,
        precio: parseFloat(precio),
        categoria,
        foto_base64,
        estado: "publicado",
        created_at: new Date().toISOString()
      };
      
      await pool.query(
        `INSERT INTO productos_socios (id, socio_id, data, created_at)
         VALUES ($1, $2, $3, NOW())`,
        [productId, socioId, productData]
      );
      
      sendJson(res, 200, { ok: true, producto_id: productId });
    } catch (e) {
      sendJson(res, 500, { ok: false, error: e.message });
    }
    return;
  }
    // Obtener foto de perfil
  if (req.method === "GET" && req.url === "/api/socios/foto") {
    const token = req.headers.authorization?.replace("Bearer ", "");
    if (!token) return sendJson(res, 401, { ok: false, error: "Token requerido" });
    
    const result = await pool.query(
      `SELECT foto_base64 FROM socios WHERE token_sesion = $1 AND token_expira > NOW()`,
      [token]
    );
    
    if (result.rows.length === 0) {
      return sendJson(res, 401, { ok: false, error: "Token inválido" });
    }
    
    sendJson(res, 200, { ok: true, foto_base64: result.rows[0].foto_base64 || null });
    return;
  }

  // Subir foto de perfil
  if (req.method === "POST" && req.url === "/api/socios/foto") {
    const token = req.headers.authorization?.replace("Bearer ", "");
    if (!token) return sendJson(res, 401, { ok: false, error: "Token requerido" });
    
    try {
      const body = await readJsonBody(req);
      const { foto_base64 } = body;
      
      const socioResult = await pool.query(
        `SELECT id FROM socios WHERE token_sesion = $1 AND token_expira > NOW()`,
        [token]
      );
      
      if (socioResult.rows.length === 0) {
        return sendJson(res, 401, { ok: false, error: "Token inválido" });
      }
      
      await pool.query(
        `UPDATE socios SET foto_base64 = $1 WHERE id = $2`,
        [foto_base64, socioResult.rows[0].id]
      );
      
      sendJson(res, 200, { ok: true });
    } catch (e) {
      sendJson(res, 500, { ok: false, error: e.message });
    }
    return;
  }
  // Obtener estrellas actualizadas del socio
  if (req.method === "GET" && req.url === "/api/socios/estrellas") {
    console.log("🔍 Endpoint /api/socios/estrellas llamado");
    const token = req.headers.authorization?.replace("Bearer ", "");
    console.log("🔍 Token recibido:", token);
    if (!token) return sendJson(res, 401, { ok: false, error: "Token requerido" });
    
    const result = await pool.query(
      `SELECT estrellas FROM socios WHERE token_sesion = $1 AND token_expira > NOW()`,
      [token]
    );
    console.log("🔍 Resultado de BD:", result.rows);
    
    if (result.rows.length === 0) {
      return sendJson(res, 401, { ok: false, error: "Token inválido" });
    }
    
    sendJson(res, 200, { ok: true, estrellas: parseFloat(result.rows[0].estrellas) || 0 });
    return;
  }
    // Obtener estrellas actualizadas del socio
  if (req.method === "GET" && req.url === "/api/socios/estrellas") {
    const token = req.headers.authorization?.replace("Bearer ", "");
    if (!token) return sendJson(res, 401, { ok: false, error: "Token requerido" });
    
    const result = await pool.query(
      `SELECT estrellas FROM socios WHERE token_sesion = $1 AND token_expira > NOW()`,
      [token]
    );
    
    if (result.rows.length === 0) {
      return sendJson(res, 401, { ok: false, error: "Token inválido" });
    }
    
    sendJson(res, 200, { ok: true, estrellas: parseFloat(result.rows[0].estrellas) || 0 });
    return;
  }
  // ============= SERVIR ARCHIVOS ESTÁTICOS =============
  let filePath = req.url === "/" ? "/index.html" : req.url;
  filePath = path.join(__dirname, filePath);
  const ext = path.extname(filePath);

  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404);
      res.end("Archivo no encontrado");
      return;
    }
    const mimeTypes = {
      ".html": "text/html",
      ".css": "text/css",
      ".js": "application/javascript",
      ".json": "application/json"
    };
    res.writeHead(200, { "Content-Type": mimeTypes[ext] || "text/plain" });
    res.end(data);
  });
});
// ============= INICIAR BOT DE TELEGRAM (SOCIO MATCH) =============
let botMatchSocio = null;
try {
  const { bot } = require("./botMatchSocio");
  botMatchSocio = bot;
  console.log("✅ BotMatchSocio iniciado correctamente");
} catch (e) {
  console.error("❌ Error iniciando BotMatchSocio:", e.message);
}
server.listen(PORT, "0.0.0.0", () => {
  console.log(`🚀 Servidor socios corriendo en http://localhost:${PORT}`);
});

module.exports = { bot: botMatchSocio };