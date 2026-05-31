const crypto = require("crypto");
require("dotenv").config();
const TelegramBot = require("node-telegram-bot-api");
const https = require("https");
const { pool } = require("./db");

const SOCIO_BOT_TOKEN = process.env.TELEGRAM_BOT_SOCIO_TOKEN;
if (!SOCIO_BOT_TOKEN) {
  console.error("❌ TELEGRAM_BOT_SOCIO_TOKEN no definido");
  process.exit(1);
}

const DEEPSEEK_KEY = process.env.DEEPSEEK_API_KEY;
if (!DEEPSEEK_KEY) {
  console.error("❌ DEEPSEEK_API_KEY no definido");
  process.exit(1);
}

const CATEGORIAS_MATCH = [
 "Agricultura", "Arte", "Camping", "Carros", "Cocina", "Computacion",
"Deportes", "Electronica", "Estetica", "Figuras", "Fotografia",
"Herramientas", "Hogar", "Iluminacion", "impresion3d", "Juegos de mesa",
"Juguetes", "Manualidades", "Mascotas", "Musica", "Peliculas",
"Radiocontrol", "Sublimacion", "Videojuegos", "Acuarofilia",
"Juguetes sexuales", "Adaptadores de corriente"
];

const GRUPOS_CATEGORIAS_MATCH = {
 "Agricultura": "-1003437569403",
  "Arte": "-1003895501867",
  "Camping": "-1003829896170",
  "Carros": "-1003949961630",
  "Cocina": "-1003833669870",
  "Computacion": "-1003867450140",
  "Deportes": "-1003828714279",
  "Electronica": "-1003847817905",
  "Estetica": "-1003483354519",
  "Figuras": "-1003753511155",
  "Fotografia": "-1003882725152",
  "Herramientas": "-1003721206046",
  "Hogar": "-1003840007865",
  "Iluminacion": "-1003898343727",
  "impresion3d": "-1003985018268",
  "Juegos de mesa": "-1003874142104",
  "Juguetes": "-1003905671566",
  "Manualidades": "-1003722195842",
  "Mascotas": "-1003713638710",
  "Musica": "-1003817435909",
  "Peliculas": "-1003703934986",
  "Radiocontrol": "-1003884473704",
  "Sublimacion": "-1003995468274",
  "Videojuegos": "-1003721430042",
  "Acuarofilia": "-5192772044",
  "Juguetes sexuales": "-5149536441",
  "Adaptadores de corriente": "-5215022991"
};


async function preguntarEnlaceAmazon(chatIdVendedor, productoId, socioId) {
  await bot.sendMessage(chatIdVendedor,
    `📦 ¿Quieres añadir un enlace de Amazon para este producto?\n\n` +
    `Envía el enlace o responde /no`,
    { parse_mode: "Markdown" }
  );
  
  const respuesta = await new Promise((resolve) => {
    const handler = (msg) => {
      if (msg.chat.id !== chatIdVendedor) return;
      bot.removeListener('message', handler);
      resolve(msg.text);
    };
    bot.on('message', handler);
  });
  
  if (respuesta && respuesta !== '/no' && (respuesta.includes('amazon.com') || respuesta.includes('amazon.es'))) {
    await pool.query(
      `UPDATE productos_socios SET amazon_link = $1 WHERE id = $2 AND socio_id = $3`,
      [respuesta, productoId, socioId]
    );
    await bot.sendMessage(chatIdVendedor, `✅ Enlace guardado.`);
  } else {
    await bot.sendMessage(chatIdVendedor, `✅ Ok, sin enlace.`);
  }
}

async function analizarMensajeConIA(mensaje, contexto) {
   if (!mensaje) return { aprobado: true, motivo: "normal", respuesta_ia: null, notas_para_vendedor: null };
  // Detectar números de teléfono (Costa Rica: 8 dígitos)
  const telefonoRegex = /\b\d{8}\b/;
  if (telefonoRegex.test(mensaje)) {
    return {
      aprobado: false,
      motivo: "telefono",
      respuesta_ia: "🚫 No está permitido compartir números de teléfono. La comunicación debe ser a través del bot por seguridad.",
      notas_para_vendedor: null
    };
  }
  
  // Detectar lenguaje ofensivo
  const ofensivas = ["estafa", "mentiroso", "rata", "ladrón", "huevón", "idiota", "pendejo", "imbecil"];
  for (const palabra of ofensivas) {
    if (mensaje.toLowerCase().includes(palabra)) {
      return {
        aprobado: false,
        motivo: "ofensivo",
        respuesta_ia: "🚫 *Mensaje bloqueado*\n\nPor favor mantén un tono respetuoso. Tu mensaje no fue enviado al vendedor.",
        notas_para_vendedor: null
      };
    }
  }
  
  // Si pasa las validaciones, el mensaje se aprueba
  return {
    aprobado: true,
    motivo: "normal",
    respuesta_ia: null,
    notas_para_vendedor: null
  };
}
async function detectarIntencion(mensaje) {
  const prompt = `
    Analiza el siguiente mensaje de un comprador y determina su intención.
    
    Mensaje: "${mensaje}"
    
    Intenciones posibles:
    - "abortar": quiere cancelar la compra (palabras como: cancelar, ya no, mejor no, déjalo, abortar, no quiero seguir)
    - "completar": quiere completar la compra (palabras como: lo quiero, sí, comprar, dale, completar, aceptar)
    - "ninguna": no hay intención clara
    
    Responde SOLO con JSON:
    {
      "intencion": "abortar" | "completar" | "ninguna",
      "confianza": 0.0-1.0
    }
  `;
  
  const body = JSON.stringify({
    model: "deepseek-chat",
    messages: [{ role: "user", content: prompt }],
    max_tokens: 50,
    temperature: 0.1
  });
  
  try {
    const response = await new Promise((resolve, reject) => {
      const req = https.request({
        hostname: "api.deepseek.com",
        path: "/v1/chat/completions",
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${DEEPSEEK_KEY}`,
          "Content-Length": Buffer.byteLength(body)
        }
      }, (res) => {
        let data = "";
        res.on("data", c => data += c);
        res.on("end", () => resolve({ status: res.statusCode, data }));
      });
      req.on("error", reject);
      req.write(body);
      req.end();
    });

    if (response.status !== 200) {
      return { intencion: "ninguna", confianza: 0 };
    }
    
    const json = JSON.parse(response.data);
    const contenido = json.choices[0].message.content;
    return JSON.parse(contenido);
    
  } catch (e) {
    console.error("Error detectando intención:", e.message);
    return { intencion: "ninguna", confianza: 0 };
  }
}
 // { chatId: { socioNumId, esperandoPregunta: true, personalizada: false } }

async function responderPreguntaHistorial(chatId, socioNumId, tipoPregunta) {
  try {
    const socioResult = await pool.query(
      `SELECT id, nombre, estrellas, total_calificaciones FROM socios WHERE num_id = $1`,
      [socioNumId]
    );
    
    if (socioResult.rows.length === 0) {
      await bot.sendMessage(chatId, "❌ Vendedor no encontrado.");
      return;
    }
    
    const socio = socioResult.rows[0];
    const socioUuid = socio.id;
    
    // Estadísticas reales
    const conversacionesResult = await pool.query(
      `SELECT COUNT(DISTINCT cliente_id) as total_clientes 
       FROM conversaciones WHERE vendedor_id = $1`,
      [String(socioUuid)]
    );
    const totalClientes = conversacionesResult.rows[0]?.total_clientes || 0;
    
    const productosResult = await pool.query(
      `SELECT COUNT(*) as vendidos 
       FROM productos_socios WHERE socio_id = $1 AND estado = 'vendido'`,
      [socioUuid]
    );
    const productosVendidos = productosResult.rows[0]?.vendidos || 0;
    
    const mensajesResult = await pool.query(
      `SELECT COUNT(*) as total_mensajes 
       FROM conversaciones WHERE vendedor_id = $1 AND remitente = 'vendedor'`,
      [String(socioUuid)]
    );
    const totalMensajes = mensajesResult.rows[0]?.total_mensajes || 0;
    
    const calificacion = parseFloat(socio.estrellas) || 0;
    const totalCalif = socio.total_calificaciones || 0;
    const estrellasLlenas = "★".repeat(Math.floor(calificacion));
    const estrellasVacias = "☆".repeat(5 - Math.floor(calificacion));
    
    let respuesta = "";
    
    switch(tipoPregunta) {
      case "ventas":
        respuesta = `📦 *${socio.nombre}* ha vendido *${productosVendidos}* productos.`;
        break;
      case "mensajes":
        respuesta = `💬 *${socio.nombre}* ha enviado *${totalMensajes}* mensajes en total.`;
        break;
      case "calificacion":
        respuesta = `⭐ *${socio.nombre}* tiene una calificación de *${calificacion.toFixed(1)}* estrellas ${estrellasLlenas}${estrellasVacias} (basada en ${totalCalif} calificaciones).`;
        break;
      case "clientes":
        respuesta = `👥 *${socio.nombre}* ha atendido a *${totalClientes}* clientes diferentes.`;
        break;
      default:
        respuesta = `Aquí están los datos de *${socio.nombre}*:\n\n• 📦 Productos vendidos: ${productosVendidos}\n• 💬 Mensajes enviados: ${totalMensajes}\n• ⭐ Calificación: ${calificacion.toFixed(1)} ★\n• 👥 Clientes atendidos: ${totalClientes}`;
    }
    
    const botonesContinuar = {
      reply_markup: {
        inline_keyboard: [
          [{ text: "🔍 Seguir preguntando", callback_data: `seguir_preguntando_${socioNumId}` }],
          [{ text: "❌ Salir", callback_data: `salir_consulta_${socioNumId}` }]
        ]
      }
    };
    
    await bot.sendMessage(chatId, respuesta, { parse_mode: "Markdown", ...botonesContinuar });
    
  } catch (error) {
    console.error("Error en responderPreguntaHistorial:", error);
    await bot.sendMessage(chatId, "❌ Error al consultar el historial.");
  }
}
const bot = new TelegramBot(SOCIO_BOT_TOKEN, { polling: true });



// Ver payload de cualquier /start
bot.onText(/\/start(.*)/, (msg, match) => {
  console.log("🔍 RAW PAYLOAD (sin decodificar):", match[1]);
  console.log("🔍 RAW TEXTO COMPLETO:", msg.text);
  console.log("🔍 LONGITUD DEL PAYLOAD:", match[1]?.length || 0);
  bot.sendMessage(msg.chat.id, "Recibido: " + msg.text);
});

// ============= ESTADO DE SESIONES DE SOCIOS =============
// { chatId: { socio_id, nombre, estrellas, foto_file_id, token } }
const sesionesSocios = {};
const publicacionesPorHora = {}; // memoria RAM
const conversacionesActivas = {}; // { chatId: chatIdDestino }
// Guardado temporal de mensajes por conversación
const conversacionesTemporales = {}; // { chatId: [{ remitente, mensaje, timestamp }] }
const sesionesConsulta = {}; // { chatId: { socioNumId, esperandoPregunta: true, personalizada: false } }
function puedePublicar(chatId) {
  const ahora = Date.now();
  const unaHora = 60 * 60 * 1000;
  
  if (!publicacionesPorHora[chatId]) {
    publicacionesPorHora[chatId] = [];
  }
  
  publicacionesPorHora[chatId] = publicacionesPorHora[chatId].filter(
    timestamp => ahora - timestamp < unaHora
  );
  
  if (publicacionesPorHora[chatId].length >= 3) {
    return false;
  }
  
  publicacionesPorHora[chatId].push(ahora);
  return true;
}

// ============= FUNCIONES AUXILIARES =============
function generarCodigo5() {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  let code = "";
  for (let i = 0; i < 5; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return code;
}

async function descargarBase64(url) {
  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      const chunks = [];
      res.on("data", c => chunks.push(c));
      res.on("end", () => resolve(Buffer.concat(chunks).toString("base64")));
      res.on("error", reject);
    }).on("error", reject);
  });
}

async function detectarCategoriaConDeepSeek(descripcion) {
  const categoriasLista = CATEGORIAS_MATCH.join(", ");
  const prompt = `Eres un clasificador de productos para Outlet Maker.
Descripción: "${descripcion}"
Categorías: ${categoriasLista}
Responde SOLO con el nombre de una categoría. Si no estás seguro, responde "Hogar".`;

  const body = JSON.stringify({
    model: "deepseek-chat",
    messages: [{ role: "user", content: prompt }],
    max_tokens: 10,
    temperature: 0
  });

  try {
    const response = await new Promise((resolve, reject) => {
      const req = https.request({
        hostname: "api.deepseek.com",
        path: "/v1/chat/completions",
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${DEEPSEEK_KEY}`,
          "Content-Length": Buffer.byteLength(body)
        }
      }, (res) => {
        let data = "";
        res.on("data", c => data += c);
        res.on("end", () => resolve({ status: res.statusCode, data }));
      });
      req.on("error", reject);
      req.write(body);
      req.end();
    });

    if (response.status !== 200) return "Hogar";
    const json = JSON.parse(response.data);
    const categoria = json.choices[0].message.content.trim();
    const valida = CATEGORIAS_MATCH.find(c => c.toLowerCase() === categoria.toLowerCase());
    return valida || "Hogar";
  } catch (e) {
    console.error("Error detectando categoría:", e.message);
    return "Hogar";
  }
}
async function extraerPuntosClave(titulo, descripcionSocio, descripcionAmazon) {
  const prompt = `
Analiza este producto y determina qué información es CRÍTICA que el comprador sepa ANTES de comprar.

TÍTULO: "${titulo}"
DESCRIPCIÓN DEL VENDEDOR: "${descripcionSocio}"
DESCRIPCIÓN DE AMAZON: "${descripcionAmazon || "No disponible"}"

Para cada posible punto de información, pregúntate:
1. ¿Es algo que TODOS los productos de este tipo tienen de fábrica? (si sí → NO es importante)
2. ¿Es algo que VARÍA entre productos y afecta la decisión de compra? (si sí → SÍ es importante)
3. ¿El comprador necesita saberlo para usar el producto correctamente? (si sí → SÍ es importante)

Instrucciones:
- Si la info ya está en la descripción del vendedor, NO la incluyas.
- Si está en Amazon pero NO en la descripción del vendedor, inclúyela.
- Ignora texto genérico como "fácil de usar", "buena calidad".

Responde SOLO con JSON:
{
  "pendientes": [
    {"texto": "texto del punto que el vendedor debe aclarar"}
  ]
}
  `;
  
  const body = JSON.stringify({
    model: "deepseek-chat",
    messages: [{ role: "user", content: prompt }],
    max_tokens: 800,
    temperature: 0.2
  });
  
  try {
    const response = await new Promise((resolve, reject) => {
      const req = https.request({
        hostname: "api.deepseek.com",
        path: "/v1/chat/completions",
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${DEEPSEEK_KEY}`,
          "Content-Length": Buffer.byteLength(body)
        }
      }, (res) => {
        let data = "";
        res.on("data", c => data += c);
        res.on("end", () => resolve({ status: res.statusCode, data }));
      });
      req.on("error", reject);
      req.write(body);
      req.end();
    });

    if (response.status !== 200) {
      console.error("Error extrayendo puntos clave:", response.status);
      return { cumplidos: [], pendientes: [] };
    }
    
    const json = JSON.parse(response.data);
    const contenido = json.choices[0].message.content;
    const parsed = JSON.parse(contenido);
    
    console.log("📋 Puntos extraídos:", parsed);
    return parsed;
    
  } catch (e) {
    console.error("Error en extraerPuntosClave:", e.message);
    return { cumplidos: [], pendientes: [] };
  }
}

async function consultarDeepSeek(pregunta, contexto) {
    const body = JSON.stringify({
        model: "deepseek-chat",
        messages: [
            { role: "system", content: "Eres un asistente que responde preguntas sobre vendedores basándote en datos reales. Responde de forma clara, amigable y útil." },
            { role: "user", content: `Contexto del vendedor:\n${contexto}\n\nPregunta del usuario: "${pregunta}"\n\nResponde en español.` }
        ],
        max_tokens: 300,
        temperature: 0.7
    });
    
    try {
        const response = await new Promise((resolve, reject) => {
            const req = https.request({
                hostname: "api.deepseek.com",
                path: "/v1/chat/completions",
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    "Authorization": `Bearer ${DEEPSEEK_KEY}`,
                    "Content-Length": Buffer.byteLength(body)
                }
            }, (res) => {
                let data = "";
                res.on("data", c => data += c);
                res.on("end", () => resolve({ status: res.statusCode, data }));
            });
            req.on("error", reject);
            req.write(body);
            req.end();
        });

        if (response.status !== 200) return "Lo siento, no pude procesar tu pregunta en este momento.";
        
        const json = JSON.parse(response.data);
        return json.choices[0].message.content;
        
    } catch (e) {
        console.error("Error en DeepSeek:", e.message);
        return "Lo siento, ocurrió un error. Intenta de nuevo.";
    }
}

async function verificarPuntosCubiertos(respuesta, puntosPendientes) {
  const prompt = `
    Responde SOLO con JSON.
    
    Respuesta del vendedor: "${respuesta}"
    Puntos pendientes: ${JSON.stringify(puntosPendientes)}
    
    Determina cuáles de los puntos pendientes (por su campo "texto") ya fueron cubiertos o respondidos en la respuesta del vendedor.
    
    Responde:
    {
      "cubiertos": ["texto del punto cubierto"],
      "mensaje": "mensaje de confirmación opcional"
    }
  `;
  
  const body = JSON.stringify({
    model: "deepseek-chat",
    messages: [{ role: "user", content: prompt }],
    max_tokens: 300,
    temperature: 0.2
  });
  
  try {
    const response = await new Promise((resolve, reject) => {
      const req = https.request({
        hostname: "api.deepseek.com",
        path: "/v1/chat/completions",
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${DEEPSEEK_KEY}`,
          "Content-Length": Buffer.byteLength(body)
        }
      }, (res) => {
        let data = "";
        res.on("data", c => data += c);
        res.on("end", () => resolve({ status: res.statusCode, data }));
      });
      req.on("error", reject);
      req.write(body);
      req.end();
    });

    if (response.status !== 200) {
      console.error("Error verificando puntos cubiertos:", response.status);
      return { cubiertos: [] };
    }
    
    const json = JSON.parse(response.data);
    const contenido = json.choices[0].message.content;
    const parsed = JSON.parse(contenido);
    
    console.log("📋 Puntos cubiertos en esta respuesta:", parsed);
    return parsed;
    
  } catch (e) {
    console.error("Error en verificarPuntosCubiertos:", e.message);
    return { cubiertos: [] };
  }
}

async function obtenerFotoPerfilSocio(userId) {
  try {
    const photos = await bot.getUserProfilePhotos(userId, { limit: 1 });
    if (photos.total_count > 0) {
      const fileId = photos.photos[0][0].file_id;
      const file = await bot.getFile(fileId);
      const url = `https://api.telegram.org/file/bot${SOCIO_BOT_TOKEN}/${file.file_path}`;
      return { fileId, url };
    }
  } catch (e) {
    console.error("Error obteniendo foto de perfil:", e.message);
  }
  return null;
}
// ============= AUTENTICACIÓN DEL SOCIO =============
// ============= MANEJADOR DE ENLACE CLIENTE -> SOCIO =============
bot.onText(/\/start confirmar_(.+)/, async (msg, match) => {
  const token = match[1];
  const chatId = msg.chat.id;
  
  console.log("🔥 Confirmar enlace ejecutado - token:", token);
  
  try {
    const productoResult = await pool.query(
      `SELECT comprador_chat_id, socio_id, data, id FROM productos_socios WHERE token = $1`,
      [token]
    );
    
    if (productoResult.rows.length === 0) {
      return bot.sendMessage(chatId, "❌ Producto no encontrado.");
    }
    
    const compradorChatId = productoResult.rows[0].comprador_chat_id;
    const productoId = productoResult.rows[0].id;
    
    if (String(msg.from.id) !== String(compradorChatId)) {
      return bot.sendMessage(chatId, "❌ Este enlace es solo para la persona que confirmó la oferta.");
    }
    
    const socioId = productoResult.rows[0].socio_id;
    const producto = productoResult.rows[0].data;
    const descripcion = producto.descripcion || "Producto";
    const precio = producto.precio || 0;
    
    // Obtener y guardar relación cliente-vendedor
    const vendedorResult = await pool.query(`SELECT telegram_chat_id FROM socios WHERE id = $1`, [socioId]);
    const vendedorChatId = vendedorResult.rows[0]?.telegram_chat_id;
    
    if (vendedorChatId) {
      conversacionesActivas[chatId] = vendedorChatId;
      conversacionesActivas[vendedorChatId] = chatId;
    }
    
    // Programar expiración en 45 minutos
    setTimeout(async () => {
      const checkProducto = await pool.query(
        `SELECT estado FROM productos_socios WHERE id = $1`,
        [productoId]
      );
      
      if (checkProducto.rows[0]?.estado === 'en_negociacion') {
        await pool.query(
          `UPDATE productos_socios SET estado = 'expirado' WHERE id = $1`,
          [productoId]
        );
        
        const vendedorId = conversacionesActivas[chatId];
        if (vendedorId) {
          await bot.sendMessage(vendedorId, "⏰ *Tiempo agotado (45 minutos). La conversación ha expirado.*", { parse_mode: "Markdown" });
        }
        await bot.sendMessage(chatId, "⏰ *Tiempo agotado (45 minutos). La conversación ha expirado.*", { parse_mode: "Markdown" });
        
        delete conversacionesActivas[chatId];
        delete conversacionesActivas[vendedorId];
        delete conversacionesTemporales[chatId];
        delete conversacionesTemporales[vendedorId];
      }
    }, 2 * 60 * 1000);
    
    // Resto del código (mostrar mensaje y botones)
    const socioResult = await pool.query(
      `SELECT nombre, estrellas, total_calificaciones FROM socios WHERE id = $1`,
      [socioId]
    );
    
    const socio = socioResult.rows[0];
    const estrellasNum = parseFloat(socio.estrellas) || 0;
    const estrellasLlenas = "★".repeat(Math.floor(estrellasNum));
    const estrellasVacias = "☆".repeat(5 - Math.floor(estrellasNum));
    const estrellasTexto = estrellasLlenas + estrellasVacias;
    
    const mensaje = 
      `🎉 <b>¡Gracias por tu interés!</b>\n\n` +
      `📦 <b>Tu compra:</b>\n${descripcion} - ₡${precio.toLocaleString('es-CR')}\n\n` +
      `👤 <b>Vendedor:</b>\n${socio.nombre}\n` +
      `⭐ <b>Calificación:</b> ${estrellasTexto} (${estrellasNum.toFixed(1)} ★ - ${socio.total_calificaciones || 0} calificaciones)\n\n` +
      `─────────────────────\n\n` +
      `✅ <b>¿Qué deseas hacer?</b>`;
    
    const socioNumResult = await pool.query(`SELECT num_id FROM socios WHERE id = $1`, [socioId]);
    const productoNumResult = await pool.query(`SELECT num_id FROM productos_socios WHERE id = $1`, [productoId]);
    const socioNumId = socioNumResult.rows[0]?.num_id;
    const productoNumId = productoNumResult.rows[0]?.num_id;
    
    const botones = {
      reply_markup: {
        inline_keyboard: [
          [{ text: "📋 CONSULTAR HISTORIAL DEL VENDEDOR", callback_data: `historial_${socioNumId}_${productoNumId}` }],
          [{ text: "💬 HABLAR DIRECTAMENTE CON EL VENDEDOR", callback_data: `hablar_${socioNumId}_${productoNumId}` }]
        ]
      }
    };
    
    await bot.sendMessage(chatId, mensaje, { parse_mode: "HTML", ...botones });
    
  } catch (error) {
    console.error("Error en manejador de confirmar:", error);
    await bot.sendMessage(chatId, "❌ Ocurrió un error.");
  }
});
// ============= INICIO =============
bot.onText(/\/start$/, async (msg) => {
  const chatId = msg.chat.id;
  const socio = sesionesSocios[chatId];
  
  console.log("⚠️⚠️⚠️ MANEJADOR VACÍO SE ACTIVÓ - texto completo:", msg.text);
  
  // Verificar si el socio tiene un producto activo
  if (socio) {
    const productoActivo = await pool.query(
      `SELECT id, estado FROM productos_socios WHERE socio_id = $1 AND estado IN ('activo', 'en_negociacion') LIMIT 1`,
      [socio.socio_id]
    );
    
    if (productoActivo.rows.length > 0) {
      const estado = productoActivo.rows[0].estado;
      let mensajeEstado = "";
      if (estado === 'activo') {
        mensajeEstado = "⏳ *Esperando confirmación en el grupo.*\nUn cliente tiene 60 segundos para confirmar.";
      } else if (estado === 'en_negociacion') {
        mensajeEstado = "💬 *Estás en conversación con un cliente.*\nEl cliente puede decidir comprar o cancelar.";
      }
      
      return bot.sendMessage(chatId,
        `⚠️ *Ya tienes un producto activo*\n\n` +
        `${mensajeEstado}\n\n` +
        `❌ *No puedes publicar otro producto hasta que este proceso termine.*\n\n` +
        `El proceso termina cuando:\n` +
        `• El cliente cancela la compra\n` +
        `• El cliente completa la compra (comparte su número)\n` +
        `• La oferta expira (60 segundos sin confirmación)`,
        { parse_mode: "Markdown" }
      );
    }
  }
  
  bot.sendMessage(chatId,
    `🤖 *BotMatch Socio - Outlet Maker*\n\n` +
    `Este bot permite a los SOCIOS publicar productos.\n\n` +
    `🔐 *Para comenzar:*\n` +
    `1. Inicia sesión en la web de Socios\n` +
    `2. Copia tu token de autenticación\n` +
    `3. Envía: /token TU_TOKEN_AQUI\n\n` +
    `📤 *Luego podrás subir fotos de tus productos.*`,
    { parse_mode: "Markdown" }
  );
});

// ============= MANEJAR BOTONES DEL CLIENTE =============
bot.on("callback_query", async (query) => {
  const data = query.data || "";
  const chatId = query.message.chat.id;
    if (data.startsWith("calificar_")) {
    const partes = data.split("_");
    const estrellas = parseInt(partes[1]);
    const vendedorTelegramId = partes[2];
    
    // Actualizar promedio de estrellas del vendedor
    const socioResult = await pool.query(
      `SELECT estrellas, total_calificaciones FROM socios WHERE telegram_chat_id = $1`,
      [vendedorTelegramId]
    );
    
    if (socioResult.rows.length > 0) {
      const socio = socioResult.rows[0];
      const totalActual = socio.total_calificaciones || 0;
      const promedioActual = parseFloat(socio.estrellas) || 0;
      
      // Calcular nuevo promedio
      const sumaTotal = promedioActual * totalActual + estrellas;
      const nuevoTotal = totalActual + 1;
      const nuevoPromedio = sumaTotal / nuevoTotal;
      
      await pool.query(
        `UPDATE socios SET estrellas = $1, total_calificaciones = $2 WHERE telegram_chat_id = $3`,
        [nuevoPromedio, nuevoTotal, vendedorTelegramId]
      );
      
      await bot.answerCallbackQuery(query.id, { text: `⭐ ¡Gracias por calificar con ${estrellas} estrellas!` });
      await bot.sendMessage(chatId, `✅ *¡Gracias por tu calificación!*\n\nHas calificado al vendedor con ${estrellas} ${estrellas === 1 ? 'estrella' : 'estrellas'}.`, { parse_mode: "Markdown" });
    }
    return;
  }
  if (data.startsWith("add_desc_")) {
    const partes = data.split("_");
    const productoUuid = partes[2];
    const socioId = partes[3];
    
    await bot.answerCallbackQuery(query.id, { text: "📝 Envía la descripción" });
    await bot.sendMessage(query.message.chat.id, "📝 Envía la descripción del producto en Amazon (puedes copiar y pegar el texto):");
    
    const handler = async (msg) => {
      if (msg.chat.id !== query.message.chat.id) return;
      const descripcion = msg.text;
      try {
        await pool.query(`UPDATE productos_socios SET amazon_descripcion = $1 WHERE id = $2`, [descripcion, productoUuid]);

              // Actualizar puntos pendientes con la descripción de Amazon
      const productoData = await pool.query(`SELECT data FROM productos_socios WHERE id = $1`, [productoUuid]);
      const descripcionSocio = productoData.rows[0].data.descripcion;
      const puntos = await extraerPuntosClave(descripcionSocio, descripcionSocio, descripcion);
      await pool.query(
        `UPDATE productos_socios SET puntos_pendientes = $1 WHERE id = $2`,
        [JSON.stringify(puntos.pendientes), productoUuid]
      );
      console.log("📋 Puntos pendientes actualizados:", puntos.pendientes);
        await bot.sendMessage(msg.chat.id, "✅ Descripción guardada. Ahora puedes escribirle al cliente.");
        
        const clienteChatId = conversacionesActivas[`cliente_${socioId}`];
        if (clienteChatId) {
          conversacionesActivas[msg.chat.id] = clienteChatId;
          conversacionesActivas[clienteChatId] = msg.chat.id;
        }
      } catch (err) {
        console.error("Error guardando descripción:", err);
        await bot.sendMessage(msg.chat.id, "❌ Error guardando la descripción.");
      }
      bot.removeListener('message', handler);
    };
    bot.on('message', handler);
    return;
  }
  
  if (data.startsWith("saltar_desc_")) {
    const partes = data.split("_");
    const productoUuid = partes[2];
    const socioId = partes[3];
    
    await bot.answerCallbackQuery(query.id, { text: "⏭️ Omitido" });
    await bot.sendMessage(query.message.chat.id, "✅ Ok. Ahora puedes escribirle al cliente.");
    
    // Activar reenvío
    console.log("🔍 socioId:", socioId);
    console.log("🔍 clave:", `cliente_${socioId}`);
    console.log("🔍 conversacionesActivas completo:", JSON.stringify(conversacionesActivas));
    const clienteChatId = conversacionesActivas[`cliente_${socioId}`];
    console.log("🔍 clienteChatId encontrado:", clienteChatId);
    if (clienteChatId) {
      conversacionesActivas[query.message.chat.id] = clienteChatId;
      conversacionesActivas[clienteChatId] = query.message.chat.id;
      console.log("✅ Reenvío activado entre", query.message.chat.id, "y", clienteChatId);
    } else {
      console.log("❌ No se encontró clienteChatId para socioId:", socioId);
    }
    return;
  }
  
  if (data.startsWith("historial_")) {
    await bot.answerCallbackQuery(query.id, { text: "🔍 Abriendo consultoría..." });
    
    const partes = data.split("_");
    const socioNumId = partes[1];
    
    // Guardar sesión de consulta para este cliente
    sesionesConsulta[chatId] = { socioNumId, esperandoPregunta: true };
    
    const mensajeBienvenida = 
        `📊 *Consultoría de Vendedor*\n\n` +
        `Puedes preguntarme lo que quieras saber sobre este vendedor. Ejemplos:\n\n` +
        `• "¿Cuántas ventas ha hecho?"\n` +
        `• "¿Qué tan rápido responde?"\n` +
        `• "¿Los clientes están satisfechos?"\n` +
        `• "¿Cuántos mensajes ha enviado?"\n` +
        `• "Cuéntame sobre su reputación"\n\n` +
        `❓ *Escribe tu pregunta o selecciona una opción:*`;
    
    const botonesPreguntas = {
      reply_markup: {
        inline_keyboard: [
          [{ text: "📦 ¿Cuántos productos ha vendido?", callback_data: `pregunta_ventas_${socioNumId}` }],
          [{ text: "💬 ¿Cuántos mensajes ha enviado?", callback_data: `pregunta_mensajes_${socioNumId}` }],
          [{ text: "⭐ ¿Cuál es su calificación?", callback_data: `pregunta_calificacion_${socioNumId}` }],
          [{ text: "👥 ¿Cuántos clientes ha atendido?", callback_data: `pregunta_clientes_${socioNumId}` }],
          [{ text: "🎤 Preguntar algo personalizado", callback_data: `pregunta_personalizada_${socioNumId}` }],
          [{ text: "❌ Salir", callback_data: `salir_consulta_${socioNumId}` }]
        ]
      }
    };
    
    await bot.sendMessage(chatId, mensajeBienvenida, { parse_mode: "Markdown", ...botonesPreguntas });
    return;
  }
    // Preguntas predefinidas del historial
  if (data.startsWith("pregunta_ventas_")) {
    const socioNumId = data.split("_")[2];
    await responderPreguntaHistorial(chatId, socioNumId, "ventas");
    return;
  }
  
  if (data.startsWith("pregunta_mensajes_")) {
    const socioNumId = data.split("_")[2];
    await responderPreguntaHistorial(chatId, socioNumId, "mensajes");
    return;
  }
  
  if (data.startsWith("pregunta_calificacion_")) {
    const socioNumId = data.split("_")[2];
    await responderPreguntaHistorial(chatId, socioNumId, "calificacion");
    return;
  }
  
  if (data.startsWith("pregunta_clientes_")) {
    const socioNumId = data.split("_")[2];
    await responderPreguntaHistorial(chatId, socioNumId, "clientes");
    return;
  }
  
  if (data.startsWith("pregunta_personalizada_")) {
    const socioNumId = data.split("_")[2];
    sesionesConsulta[chatId] = { socioNumId, esperandoPregunta: true, personalizada: true };
    await bot.sendMessage(chatId, "✏️ *Escribe tu pregunta personalizada:*", { parse_mode: "Markdown" });
    return;
  }
  
  if (data.startsWith("salir_consulta_")) {
    const socioNumId = data.split("_")[2];
    delete sesionesConsulta[chatId];
    await bot.sendMessage(chatId, "✅ *Consultoría finalizada. ¡Gracias por usar Outlet Maker!*", { parse_mode: "Markdown" });
    return;
  }
  
  if (data.startsWith("seguir_preguntando_")) {
    const socioNumId = data.split("_")[2];
    sesionesConsulta[chatId] = { socioNumId, esperandoPregunta: true };
    
    const botonesOpciones = {
      reply_markup: {
        inline_keyboard: [
          [{ text: "📦 Productos vendidos", callback_data: `pregunta_ventas_${socioNumId}` }],
          [{ text: "💬 Mensajes enviados", callback_data: `pregunta_mensajes_${socioNumId}` }],
          [{ text: "⭐ Calificación", callback_data: `pregunta_calificacion_${socioNumId}` }],
          [{ text: "👥 Clientes atendidos", callback_data: `pregunta_clientes_${socioNumId}` }],
          [{ text: "✏️ Pregunta personalizada", callback_data: `pregunta_personalizada_${socioNumId}` }],
          [{ text: "❌ Salir", callback_data: `salir_consulta_${socioNumId}` }]
        ]
      }
    };
    
    await bot.sendMessage(chatId, "❓ *¿Qué más quieres saber sobre este vendedor?*", { parse_mode: "Markdown", ...botonesOpciones });
    return;
  }
  
  if (data.startsWith("hablar_")) {
    console.log("🔥 Entró a hablar_");
    await bot.answerCallbackQuery(query.id, { text: "📞 Conectando..." });
    await bot.sendMessage(chatId, "✅ *Listo, esperando al vendedor.*\n\nEn breve se pondrá en contacto contigo.", { parse_mode: "Markdown" });
    
    const partes = data.split("_");
    const socioId = partes[1];
    const productoId = partes[2];
    console.log("📊 socioId:", socioId, "productoId:", productoId);
    
    // Guardar el chatId del cliente para usarlo después
    conversacionesActivas[`cliente_${socioId}`] = chatId;
    
    const vendedorResult = await pool.query(`SELECT telegram_chat_id FROM socios WHERE num_id = $1`, [socioId]);
    const vendedorChatId = vendedorResult.rows[0]?.telegram_chat_id;
    console.log("📊 vendedorChatId:", vendedorChatId);
    
    if (vendedorChatId) {
      console.log("✅ Vendedor encontrado, enviando mensaje...");
      const productoUuidResult = await pool.query(`SELECT id FROM productos_socios WHERE num_id = $1`, [productoId]);
      const productoUuid = productoUuidResult.rows[0]?.id;
      console.log("📊 productoUuid:", productoUuid);
      
      // Inicializar puntos pendientes
      await pool.query(
        `UPDATE productos_socios SET puntos_pendientes = puntos_clave WHERE id = $1`,
        [productoUuid]
      );
      console.log("✅ Puntos pendientes inicializados");
      
      await bot.sendMessage(vendedorChatId,
        `📦 *Un cliente quiere hablar contigo*\n\n` +
        `¿Quieres añadir la descripción del producto en Amazon?\n\n`,
        { 
          parse_mode: "Markdown",
          reply_markup: {
            inline_keyboard: [
              [{ text: "📝 Añadir descripción", callback_data: `add_desc_${productoUuid}_${socioId}` }],
              [{ text: "⏭️ Saltar", callback_data: `saltar_desc_${productoUuid}_${socioId}` }]
            ]
          }
        }
      );
      console.log("✅ Mensaje enviado al vendedor");
    } else {
      console.log("❌ Vendedor NO encontrado");
    }
    return;
  }

  if (data.startsWith("abortar_")) {
    const clienteId = data.split("_")[1];
    const vendedorId = conversacionesActivas[clienteId];
    
    // Obtener el producto activo y cambiarlo a 'cancelado'
    if (vendedorId) {
      const socioIdResult = await pool.query(
        `SELECT id FROM socios WHERE telegram_chat_id = $1`,
        [String(vendedorId)]
      );
      if (socioIdResult.rows.length > 0) {
        await pool.query(
          `UPDATE productos_socios SET estado = 'cancelado' WHERE socio_id = $1 AND estado = 'en_negociacion'`,
          [socioIdResult.rows[0].id]
        );
        console.log("✅ Producto cancelado por el cliente");
      }
    }
    
    await bot.sendMessage(clienteId, "❌ *Has cancelado la compra.*", { parse_mode: "Markdown" });
    if (vendedorId) {
      await bot.sendMessage(vendedorId, "❌ *El cliente ha cancelado la compra.*", { parse_mode: "Markdown" });
    }
    
    // Limpiar conversación
    delete conversacionesActivas[clienteId];
    delete conversacionesActivas[vendedorId];
    delete conversacionesTemporales[clienteId];
    delete conversacionesTemporales[vendedorId];
    return;
  }
  
  if (data.startsWith("completar_")) {
    const clienteId = data.split("_")[1];
    const vendedorId = conversacionesActivas[clienteId];
    
    const botones = {
      reply_markup: {
        keyboard: [
          [{ text: "📱 Compartir mi número", request_contact: true }]
        ],
        one_time_keyboard: true,
        resize_keyboard: true
      }
    };
    
    await bot.sendMessage(clienteId, "✅ *Para completar la compra, comparte tu número de teléfono presionando el botón:*", { parse_mode: "Markdown", ...botones });
    
    if (vendedorId) {
      await bot.sendMessage(vendedorId, "✅ *El cliente ha completado la compra. En breve recibirás su número.*", { parse_mode: "Markdown" });
    }
    return;
  }
  
  if (data.startsWith("seguir_")) {
    await bot.answerCallbackQuery(query.id, { text: "✅ Continuando conversación" });
    await bot.sendMessage(chatId, "✅ *Puedes seguir con la conversación.*", { parse_mode: "Markdown" });
    return;
  }
});

// ============= REENVÍO DE MENSAJES =============
bot.on('message', async (msg) => {
    const chatId = msg.chat.id;
    
    if (msg.text && msg.text.startsWith('/')) return;
    
    // 🔥 SI ES PREGUNTA PERSONALIZADA, NO REENVIAR
    const sesion = sesionesConsulta[chatId];
    if (sesion && sesion.personalizada) {
        console.log(`📵 [REENVÍO] Ignorando mensaje porque es pregunta personalizada`);
        return;
    }
    
    const destinoId = conversacionesActivas[chatId];
    if (!destinoId) return;
    
    console.log(`📤 [REENVÍO] Reenviando mensaje a ${destinoId}`);
    
    // Verificar si es texto (bloquear fotos, videos, audios)
    if (!msg.text) {
        const mensajeAdvertencia = "📵 *No está permitido enviar fotos, videos o audios en esta conversación.*\n\nSolo se permiten mensajes de texto por seguridad.";
        await bot.sendMessage(chatId, mensajeAdvertencia, { parse_mode: "Markdown" });
        return;
    }
    
    // Determinar quién es el remitente
    let remitente = '';
    const socioResult = await pool.query(`SELECT id FROM socios WHERE telegram_chat_id = $1`, [String(chatId)]);
    if (socioResult.rows.length > 0) {
        remitente = 'vendedor';
    } else {
        remitente = 'cliente';
    }
    
    // Detectar intención del cliente (abortar/completar)
    if (remitente === 'cliente') {
        const destinoId = conversacionesActivas[chatId];
        console.log("🔍 Cliente detectado - chatId:", chatId, "destinoId:", destinoId);
        
        const intencion = await detectarIntencion(msg.text);
        console.log("🔍 Intención detectada:", intencion);
        
        if (intencion.intencion === 'abortar' && intencion.confianza > 0.7) {
            console.log("✅ Entró a ABORTAR");
            let aviso = "";
            const socioUuidResult = await pool.query(
                `SELECT id FROM socios WHERE telegram_chat_id = $1`,
                [destinoId]
            );
            const socioUuid = socioUuidResult.rows[0]?.id;
            console.log("🔍 socioUuid encontrado:", socioUuid);
            
            const productoResult = await pool.query(
                `SELECT puntos_pendientes, estado FROM productos_socios WHERE socio_id = $1 AND estado IN ('activo', 'en_negociacion') ORDER BY created_at DESC LIMIT 1`,
                [socioUuid]
            );
            console.log("🔍 productoResult estado:", productoResult.rows[0]?.estado);
            console.log("🔍 productoResult puntos_pendientes:", productoResult.rows[0]?.puntos_pendientes);
            
            const puntosPendientes = productoResult.rows[0]?.puntos_pendientes || [];
            console.log("📋 Puntos pendientes para aviso:", puntosPendientes.length);
            if (puntosPendientes.length > 0) {
                aviso = `⚠️ *El vendedor aún no ha aclarado toda la información importante sobre el producto.*\n\n`;
            }
            
            const botones = {
                reply_markup: {
                    inline_keyboard: [
                        [{ text: "❌ SÍ, ABORTAR CONVERSACIÓN", callback_data: `abortar_${chatId}` }],
                        [{ text: "🔄 NO, SEGUIR CONVERSACIÓN", callback_data: `seguir_${chatId}` }]
                    ]
                }
            };
            await bot.sendMessage(chatId, aviso + "⚠️ *¿Quieres cancelar esta compra?*", { parse_mode: "Markdown", ...botones });
            return;
        }
        
        if (intencion.intencion === 'completar' && intencion.confianza > 0.7) {
            console.log("✅ Entró a COMPLETAR");
            let aviso = "";
            const socioUuidResult = await pool.query(
                `SELECT id FROM socios WHERE telegram_chat_id = $1`,
                [destinoId]
            );
            const socioUuid = socioUuidResult.rows[0]?.id;
            console.log("🔍 socioUuid encontrado:", socioUuid);
            
            const productoResult = await pool.query(
                `SELECT puntos_pendientes, estado FROM productos_socios WHERE socio_id = $1 AND estado IN ('activo', 'en_negociacion') ORDER BY created_at DESC LIMIT 1`,
                [socioUuid]
            );
            console.log("🔍 productoResult estado:", productoResult.rows[0]?.estado);
            console.log("🔍 productoResult puntos_pendientes:", productoResult.rows[0]?.puntos_pendientes);
            
            const puntosPendientes = productoResult.rows[0]?.puntos_pendientes || [];
            console.log("📋 Puntos pendientes para aviso:", puntosPendientes.length);
            if (puntosPendientes.length > 0) {
                aviso = `⚠️ *El vendedor aún no ha aclarado toda la información importante sobre el producto.*\n\n`;
            }
            
            const botones = {
                reply_markup: {
                    inline_keyboard: [
                        [{ text: "✅ SÍ, COMPARTIR MI NÚMERO", callback_data: `completar_${chatId}` }],
                        [{ text: "🔄 NO, SEGUIR CONVERSACIÓN", callback_data: `seguir_${chatId}` }]
                    ]
                }
            };
            await bot.sendMessage(chatId, aviso + "✅ *¿Quieres completar la compra y compartir tu número con el vendedor?*", { parse_mode: "Markdown", ...botones });
            return;
        }
        console.log("❌ No entró a ninguna intención relevante");
    }
    
    // Intervención de IA (DeepSeek)
    const analisis = await analizarMensajeConIA(msg.text, {});
    
    if (!analisis.aprobado) {
        await bot.sendMessage(chatId, analisis.respuesta_ia);
        return;
    }
    
    // Si el mensaje es del vendedor, verificar puntos pendientes
    if (remitente === 'vendedor') {
        const productoResult = await pool.query(
            `SELECT id, puntos_pendientes FROM productos_socios WHERE socio_id = (SELECT id FROM socios WHERE telegram_chat_id = $1) AND estado = 'en_negociacion' ORDER BY created_at DESC LIMIT 1`,
            [String(chatId)]
        );
        
        if (productoResult.rows.length > 0 && productoResult.rows[0].puntos_pendientes) {
            let puntosPendientes = productoResult.rows[0].puntos_pendientes;
            
            if (puntosPendientes.length > 0) {
                const analisis = await verificarPuntosCubiertos(msg.text, puntosPendientes);
                
                if (analisis.cubiertos && analisis.cubiertos.length > 0) {
                    puntosPendientes = puntosPendientes.filter(p => 
                        !analisis.cubiertos.some(c => c === p.texto)
                    );
                    await pool.query(
                        `UPDATE productos_socios SET puntos_pendientes = $1 WHERE id = $2`,
                        [JSON.stringify(puntosPendientes), productoResult.rows[0].id]
                    );
                }
                
                if (puntosPendientes.length > 0) {
                    const mensajePendientes = puntosPendientes.map(p => `• ${p.texto}`).join('\n');
                    await bot.sendMessage(chatId, 
                        `⚠️ *Todavía debes aclarar estos puntos:*\n\n${mensajePendientes}\n\nPor favor responde incluyendo esta información.`,
                        { parse_mode: "Markdown" }
                    );
                }
            }
        }
    }
    
    // Guardar mensaje en RAM temporal
    console.log("📝 Guardando en RAM:", chatId, msg.text);
    if (!conversacionesTemporales[chatId]) conversacionesTemporales[chatId] = [];
    conversacionesTemporales[chatId].push({
        remitente: remitente,
        mensaje: msg.text,
        timestamp: Date.now()
    });
    
    if (!conversacionesTemporales[destinoId]) conversacionesTemporales[destinoId] = [];
    conversacionesTemporales[destinoId].push({
        remitente: remitente,
        mensaje: msg.text,
        timestamp: Date.now()
    });
    
    try {
        await bot.sendMessage(destinoId, msg.text);
    } catch (e) {
        console.error("Error reenviando mensaje:", e.message);
    }
});

bot.onText(/\/finalizar/, async (msg) => {
  console.log("🔥 COMANDO /finalizar EJECUTADO por:", msg.chat.id);
  const chatId = msg.chat.id;
  const destinoId = conversacionesActivas[chatId];
   console.log("📊 destinoId:", destinoId);
  console.log("📊 conversacionesActivas:", conversacionesActivas);
  if (!destinoId) {
    return bot.sendMessage(chatId, "❌ No hay conversación activa.");
  }
  
  const mensajes = conversacionesTemporales[chatId] || [];
  
  if (mensajes.length === 0) {
    return bot.sendMessage(chatId, "❌ No hay mensajes para guardar.");
  }
  
  // Guardar todos los mensajes en la base de datos
  for (const m of mensajes) {
    await pool.query(
      `INSERT INTO conversaciones (cliente_id, vendedor_id, mensaje, remitente, created_at)
       VALUES ($1, $2, $3, $4, to_timestamp($5))`,
      [String(destinoId), String(chatId), m.mensaje, m.remitente, m.timestamp / 1000]
    );
  }
  
  // Limpiar RAM
  delete conversacionesTemporales[chatId];
  delete conversacionesTemporales[destinoId];
  delete conversacionesActivas[chatId];
  delete conversacionesActivas[destinoId];
  
  await bot.sendMessage(chatId, "✅ Conversación finalizada y guardada en el historial.");
  await bot.sendMessage(destinoId, "✅ La conversación ha finalizado. Gracias por usar Outlet Maker.");
});
bot.on("contact", async (msg) => {
   console.log("📞📞📞 EVENTO CONTACT DISPARADO 📞📞📞");
  console.log("📞 chatId:", msg.chat.id);
  console.log("📞 contacto:", msg.contact);
  console.log("📞 conversacionesActivas:", JSON.stringify(conversacionesActivas, null, 2));
  console.log("📞 conversacionesTemporales:", Object.keys(conversacionesTemporales));
  
  const clienteId = msg.chat.id;
  const telefono = msg.contact.phone_number;
  const nombre = msg.contact.first_name;
  
  const vendedorId = conversacionesActivas[clienteId];
  
  if (vendedorId) {
    // ========== GUARDAR CONVERSACIÓN EN BD ==========
    const mensajes = conversacionesTemporales[clienteId] || [];
    
    for (const m of mensajes) {
      await pool.query(
        `INSERT INTO conversaciones (cliente_id, vendedor_id, mensaje, remitente, created_at)
         VALUES ($1, $2, $3, $4, to_timestamp($5))`,
        [String(clienteId), String(vendedorId), m.mensaje, m.remitente, m.timestamp / 1000]
      );
    }
    console.log(`✅ Conversación guardada: ${mensajes.length} mensajes`);
    // =============================================
    
    // Obtener el producto activo y marcarlo como vendido
    const socioIdResult = await pool.query(
      `SELECT id FROM socios WHERE telegram_chat_id = $1`,
      [String(vendedorId)]
    );
    
    if (socioIdResult.rows.length > 0) {
      const productoResult = await pool.query(
        `SELECT id FROM productos_socios WHERE socio_id = $1 AND estado = 'en_negociacion' ORDER BY created_at DESC LIMIT 1`,
        [socioIdResult.rows[0].id]
      );
      
      if (productoResult.rows.length > 0) {
        await pool.query(
          `UPDATE productos_socios SET estado = 'vendido' WHERE id = $1`,
          [productoResult.rows[0].id]
        );
        console.log("✅ Producto marcado como vendido");
      }
    }
    
    await bot.sendMessage(vendedorId, `📞 *El cliente ${nombre} ha compartido su número:*\n${telefono}`, { parse_mode: "Markdown" });
    
    // Botones de calificación...
    const botonesEstrellas = {
      reply_markup: {
        inline_keyboard: [[
          { text: "⭐ 1", callback_data: `calificar_1_${vendedorId}` },
          { text: "⭐⭐ 2", callback_data: `calificar_2_${vendedorId}` },
          { text: "⭐⭐⭐ 3", callback_data: `calificar_3_${vendedorId}` },
          { text: "⭐⭐⭐⭐ 4", callback_data: `calificar_4_${vendedorId}` },
          { text: "⭐⭐⭐⭐⭐ 5", callback_data: `calificar_5_${vendedorId}` }
        ]]
      }
    };
    
    await bot.sendMessage(clienteId, 
      "✅ *¡Gracias por tu compra!*\n\n" +
      "El vendedor recibió tu número y se pondrá en contacto contigo.\n\n" +
      "⭐ *¿Cómo calificas la experiencia con este vendedor?*",
      { parse_mode: "Markdown", ...botonesEstrellas }
    );
  }
  
  // Limpiar conversación (DESPUÉS de guardar)
  delete conversacionesActivas[clienteId];
  delete conversacionesActivas[vendedorId];
  delete conversacionesTemporales[clienteId];
  delete conversacionesTemporales[vendedorId];
});
bot.onText(/\/token (.+)/, async (msg, match) => {
  // Solo responder en chats privados
  if (msg.chat.type !== 'private') return;
  
  const chatId = msg.chat.id;
  const token = match[1].trim();

  try {
    const result = await pool.query(
      `SELECT id, nombre, estrellas, total_calificaciones FROM socios WHERE token_sesion = $1 AND token_expira > NOW()`,
      [token]
    );

    if (result.rows.length === 0) {
      return bot.sendMessage(chatId, "❌ Token inválido o expirado. Inicia sesión en la web.");
    }

    const socio = result.rows[0];
    const foto = await obtenerFotoPerfilSocio(msg.from.id);
    
    let estrellasNum = parseFloat(socio.estrellas);
    if (isNaN(estrellasNum)) estrellasNum = 0;

    sesionesSocios[chatId] = {
      socio_id: socio.id,
      nombre: socio.nombre,
      estrellas: estrellasNum,
      foto_file_id: foto?.fileId || null,
      token: token
    };
    
    // Guardar chatId en la base de datos
    const updateResult = await pool.query(
      `UPDATE socios SET telegram_chat_id = $1 WHERE id = $2`,
      [chatId, socio.id]
    );
    console.log("✅ Socio autenticado - chatId:", chatId, "socio_id:", socio.id);
    console.log("📝 Actualización BD - filas afectadas:", updateResult.rowCount);

    const estrellasLlenas = "★".repeat(Math.floor(estrellasNum));
    const estrellasVacias = "☆".repeat(5 - Math.floor(estrellasNum));
    const estrellasTexto = estrellasLlenas + estrellasVacias;

    await bot.sendMessage(chatId,
      "✅ *¡Bienvenido " + socio.nombre + "!*\n\n" +
      "⭐ *Calificación:* " + estrellasTexto + " (" + estrellasNum.toFixed(1) + ")\n\n" +
      "📤 *Para publicar un producto:*\n" +
      "1. Enviá una FOTO\n" +
      "2. En el caption escribí:\n" +
      "   Precio: 25000\n" +
      "   Descripción: Tu descripción aquí\n\n" +
      "¡Los clientes recibirán tu oferta en los grupos! 🚀",
      { parse_mode: "Markdown" }
    );
  } catch (e) {
    console.error("Error en autenticación:", e);
    bot.sendMessage(chatId, "❌ Error al autenticar: " + e.message);
  }
});

async function publicarEnGrupo(categoria, articuloInfo, fileId, socioInfo) {
  const grupoId = GRUPOS_CATEGORIAS_MATCH[categoria];
  if (!grupoId) {
    console.log(`⚠️ No hay grupo para: ${categoria}`);
    return null;
  }

  const publicacionId = Date.now().toString();
  const estrellasTexto = "★".repeat(Math.floor(socioInfo.estrellas || 0)) + "☆".repeat(5 - Math.floor(socioInfo.estrellas || 0));

  let caption = `🆕 *NUEVO ARTÍCULO - SOCIO*\n\n`;
  caption += `👤 *Vendedor:* ${socioInfo.nombre}\n`;
  caption += `⭐ *Calificación:* ${estrellasTexto} (${(socioInfo.estrellas || 0).toFixed(1)})\n\n`;
  caption += `📦 *Descripción:* ${articuloInfo.descripcion}\n`;
  caption += `💰 *Precio:* ₡${articuloInfo.precio}\n\n`;
  caption += `⏱️ *Oferta válida por: 60 segundos*\n\n`;
  caption += `👇 Hacé clic en CONFIRMAR si querés llevártelo.`;

  const mensaje = await bot.sendPhoto(grupoId, fileId, {
    caption: caption,
    parse_mode: "Markdown",
    reply_markup: {
      inline_keyboard: [[
        { text: `✅ CONFIRMAR`, callback_data: `socio_confirmar_${publicacionId}` }
      ]]
    }
  });

  // Promesa que se resuelve cuando alguien confirma o expira
  return new Promise((resolve) => {
    let respondido = false;
    
    // Temporizador de 60 segundos
    const timer = setTimeout(async () => {
      if (!respondido) {
        respondido = true;
        // Actualizar estado a 'expirado' en BD
        await pool.query(
          `UPDATE productos_socios SET estado = 'expirado' WHERE id = $1`,
          [articuloInfo.id]
        ).catch(() => {});
        bot.editMessageCaption(`⏰ *OFERTA EXPIRADA*\n\n📦 ${articuloInfo.descripcion}\n\nYa nadie reclamó este artículo.`, {
          chat_id: grupoId,
          message_id: mensaje.message_id,
          parse_mode: "Markdown"
        }).catch(() => {});
        bot.editMessageReplyMarkup({ inline_keyboard: [] }, {
          chat_id: grupoId,
          message_id: mensaje.message_id
        }).catch(() => {});
        resolve({ confirmado: false });
      }
    }, 60000);

    // Escuchar confirmaciones
    const handler = async (query) => {
      if (query.data === `socio_confirmar_${publicacionId}` && !respondido) {
        respondido = true;
        clearTimeout(timer);
        
        const usuario = query.from;

        
        
       
        
        // Actualizar estado del producto a 'en_negociacion'
        await pool.query(
          `UPDATE productos_socios SET estado = 'en_negociacion' WHERE id = $1`,
          [articuloInfo.id]
        ).catch(() => {});

                // Guardar quién confirmó (comprador_chat_id)
        await pool.query(
          `UPDATE productos_socios SET comprador_chat_id = $1 WHERE id = $2`,
          [usuario.id, articuloInfo.id]
        );
        console.log("✅ comprador_chat_id guardado:", usuario.id);
        
        await bot.answerCallbackQuery(query.id, { text: "✅ ¡Oferta confirmada! En breve te contactamos." });
        
        await bot.editMessageCaption(`✅ *¡OFERTA CONFIRMADA!*\n\n📦 ${articuloInfo.descripcion}\n\nReservado por: ${usuario.first_name || "Alguien"}`, {
          chat_id: grupoId,
          message_id: mensaje.message_id,
          parse_mode: "Markdown"
        });
             // 👁️ ESPÍA DE MEMORIA RAM - Vamos a ver qué traen estos objetos
        console.log("================ BANCO DE PRUEBAS RAM ================");
        console.log("📦 CONTENIDO DE articuloInfo:", JSON.stringify(articuloInfo, null, 2));
        console.log("👤 CONTENIDO DE socioInfo (RAM):", JSON.stringify(socioInfo, null, 2));
        console.log("======================================================");
// Generar enlace único uniendo estrictamente las propiedades existentes
        const botUsername = "Matchsociobot";
       // Obtener num_id del socio
const socioNumResult = await pool.query(`SELECT num_id FROM socios WHERE id = $1`, [articuloInfo.socio_id]);
const productoNumResult = await pool.query(`SELECT num_id FROM productos_socios WHERE id = $1`, [articuloInfo.id]);

const idSocioSeguro = socioNumResult.rows[0]?.num_id;
const idProductoSeguro = productoNumResult.rows[0]?.num_id;

if (!idSocioSeguro || !idProductoSeguro) {
  console.log("❌ No se encontraron num_id");
  return;
}
        
        const idSocioCorto = String(idSocioSeguro).substring(0, 8);
const idProductoCorto = String(idProductoSeguro).substring(0, 8);
               // Obtener el token del producto
        const tokenResult = await pool.query(`SELECT token FROM productos_socios WHERE id = $1`, [articuloInfo.id]);
        const token = tokenResult.rows[0]?.token;
        
        console.log("🔍 Token del producto:", token);
        const enlaceCliente = `https://t.me/${botUsername}?start=confirmar_${token}`;
        console.log("🔗 ENLACE GENERADO:", enlaceCliente);
        console.log("🔗 ENLACE GENERADO EN GRUPO:", enlaceCliente);


        // Enviar SOLO UNA VEZ el mensaje con el enlace al grupo
        await bot.sendMessage(grupoId, 
          `👤 *${usuario.first_name}*, para contactar al vendedor, hacé clic aquí:\n\n` +
          `👉 [CONTACTAR VENDEDOR](${enlaceCliente})`,
          { parse_mode: "Markdown", disable_web_page_preview: true }
        );
// Notificar al socio (vendedor)
    // Obtener chatId del vendedor desde la base de datos
    console.log("🔍 Buscando vendedor con socio_id:", socioInfo.socio_id);
    const vendedorResult = await pool.query(
      `SELECT telegram_chat_id FROM socios WHERE id = $1`,
      [socioInfo.socio_id]
    );
    console.log("📊 Resultado BD:", vendedorResult.rows);
    const chatIdVendedor = vendedorResult.rows[0]?.telegram_chat_id;
    console.log("📱 chatIdVendedor encontrado:", chatIdVendedor);
if (chatIdVendedor) {
  await bot.sendMessage(chatIdVendedor,
  `✅ <b>¡Alguien quiere contactarte!</b>\n\n` +
  `👤 <b>Cliente:</b> ${(usuario.first_name || "Sin nombre")} @${usuario.username || "sin username"}\n` +
  `📦 <b>Producto:</b> ${articuloInfo.descripcion}\n` +
  `💰 <b>Precio:</b> ₡${articuloInfo.precio}`,
  { parse_mode: "HTML", disable_web_page_preview: true }
);
  // await preguntarEnlaceAmazon(chatIdVendedor, articuloInfo.id, socioInfo.socio_id);
}
        resolve({ confirmado: true, usuario });
        
        // Eliminar el listener después de usarlo
        bot.removeListener("callback_query", handler);
      }
    };
    
    bot.on("callback_query", handler);
  });
}








// ============= MANEJAR FOTOS DEL SOCIO =============
bot.on("photo", async (msg) => {
  // Solo responder en chats privados
  if (msg.chat.type !== 'private') return;
  
  const chatId = msg.chat.id;
  const socio = sesionesSocios[chatId];

  if (!socio) {
    return bot.sendMessage(chatId, "🔐 Primero autentícate con /token <tu_token>");
  }
    // Verificar límite de 3 publicaciones por hora
  if (!puedePublicar(chatId)) {
    return bot.sendMessage(chatId, "⏰ *Límite alcanzado*\n\nSolo puedes publicar 3 productos por hora. Espera un momento.", { parse_mode: "Markdown" });
  }

  if (msg.chat.type !== 'private') return;

  const caption = msg.caption || "";
  
  const precioMatch = caption.match(/[Pp]recio:\s*([\d,.]+)/);
  const precio = precioMatch ? precioMatch[1].replace(/,/g, "") : null;
  
  let descripcion = caption.replace(/[Pp]recio:\s*[\d,.]+/g, "").trim();
  if (!descripcion) descripcion = "Sin descripción";

  if (!precio) {
    return bot.sendMessage(chatId, "❌ Debes especificar el precio. Ejemplo: Precio: 25000");
  }

  await bot.sendMessage(chatId, "📝 Procesando tu publicación...");

  const bestPhoto = msg.photo.reduce((a, b) => (a.file_size > b.file_size ? a : b));
  
  const categoria = await detectarCategoriaConDeepSeek(descripcion);
  await bot.sendMessage(chatId, `📂 Categoría detectada: *${categoria}*`, { parse_mode: "Markdown" });

  // Guardar producto en la base de datos
  const productId = crypto.randomUUID();
  const productData = {
    descripcion: descripcion,
    precio: parseInt(precio),
    foto_base64: bestPhoto.file_id,
    categoria: categoria,
    estado: 'activo'
  };
  
  await pool.query(
    `INSERT INTO productos_socios (id, socio_id, data, created_at, estado)
     VALUES ($1, $2, $3, NOW(), $4)`,
    [productId, socio.socio_id, productData, 'activo']
  );
  console.log("✅ Producto guardado en BD - ID:", productId);
  
  // Generar token corto (8 caracteres)
  const token = crypto.randomBytes(4).toString('hex');
  await pool.query(
    `UPDATE productos_socios SET token = $1 WHERE id = $2`,
    [token, productId]
  );
  console.log("✅ Token generado:", token);

  // Extraer puntos clave del producto
  const puntos = await extraerPuntosClave(descripcion, descripcion, null);
  console.log("📋 Puntos extraídos:", JSON.stringify(puntos, null, 2));
  
  // Guardar puntos_clave (para historial) y puntos_pendientes (para verificar)
  await pool.query(
    `UPDATE productos_socios SET puntos_clave = $1, puntos_pendientes = $2 WHERE id = $3`,
    [JSON.stringify(puntos.pendientes || []), JSON.stringify(puntos.pendientes || []), productId]
  );
  console.log("✅ Puntos guardados en BD - cumplidos:", puntos.cumplidos?.length || 0, "pendientes:", puntos.pendientes?.length || 0);

  const articuloInfo = {
    id: productId,
    descripcion: descripcion,
    precio: parseInt(precio),
    fileId: bestPhoto.file_id,
    socio_id: socio.socio_id
  };

  if (GRUPOS_CATEGORIAS_MATCH[categoria]) {
    await bot.sendMessage(chatId, `📤 Publicando en el grupo de *${categoria}*...`, { parse_mode: "Markdown" });
    
    const resultado = await publicarEnGrupo(categoria, articuloInfo, bestPhoto.file_id, socio);
    
    if (resultado && resultado.confirmado) {
      await bot.sendMessage(chatId, `✅ ¡Alguien confirmó tu oferta!\n\n📦 ${descripcion}\n💰 ₡${precio}\n\nPronto nos pondremos en contacto con el comprador.`);
    } else {
      await bot.sendMessage(chatId, `⏰ *OFERTA EXPIRADA*\n\nNadie confirmó tu producto en el grupo.\n\n📦 ${descripcion}\n💰 ₡${precio}\n\nEl producto ha sido marcado como expirado.`, { parse_mode: "Markdown" });
    }
  } else {
    await bot.sendMessage(chatId, `⚠️ No hay grupo para la categoría: ${categoria}`);
  }
});


bot.onText(/\/calificar/, async (msg) => {
  const chatId = msg.chat.id;
  
  // Buscar la última compra del cliente
  const compraResult = await pool.query(
    `SELECT socio_id FROM conversaciones WHERE cliente_id = $1 ORDER BY created_at DESC LIMIT 1`,
    [String(chatId)]
  );
  
  if (compraResult.rows.length === 0) {
    return bot.sendMessage(chatId, "❌ No tienes compras recientes para calificar.");
  }
  
  const socioId = compraResult.rows[0].socio_id;
  const vendedorTelegramResult = await pool.query(`SELECT telegram_chat_id FROM socios WHERE id = $1`, [socioId]);
  const vendedorTelegramId = vendedorTelegramResult.rows[0]?.telegram_chat_id;
  
  const botonesEstrellas = {
    reply_markup: {
      inline_keyboard: [[
        { text: "⭐ 1", callback_data: `calificar_1_${vendedorTelegramId}` },
        { text: "⭐⭐ 2", callback_data: `calificar_2_${vendedorTelegramId}` },
        { text: "⭐⭐⭐ 3", callback_data: `calificar_3_${vendedorTelegramId}` },
        { text: "⭐⭐⭐⭐ 4", callback_data: `calificar_4_${vendedorTelegramId}` },
        { text: "⭐⭐⭐⭐⭐ 5", callback_data: `calificar_5_${vendedorTelegramId}` }
      ]]
    }
  };
  
  await bot.sendMessage(chatId, "⭐ *Califica tu experiencia con el vendedor:*", { parse_mode: "Markdown", ...botonesEstrellas });
});

// ============= MANEJAR PREGUNTAS PERSONALIZADAS (IA) - PRIMERO =============
// ============= MANEJAR PREGUNTAS PERSONALIZADAS (IA) =============
bot.on('message', async (msg) => {
    const chatId = msg.chat.id;
    const texto = msg.text;
    
    console.log(`🤖 [IA HANDLER] Entró - texto: "${texto}"`);
    
    if (!texto || texto.startsWith('/')) return;
    
    const sesion = sesionesConsulta[chatId];
    console.log(`🤖 [IA HANDLER] sesion: ${JSON.stringify(sesion)}`);
    
    if (!sesion || !sesion.personalizada) {
        console.log(`🤖 [IA HANDLER] No es pregunta personalizada, saliendo`);
        return;
    }
    
    console.log(`✅ [IA HANDLER] ¡ES PREGUNTA PERSONALIZADA! Procesando...`);
    
    const socioNumId = sesion.socioNumId;
    
    try {
        const socioResult = await pool.query(
            `SELECT id, nombre, estrellas, total_calificaciones FROM socios WHERE num_id = $1`,
            [socioNumId]
        );
        
        if (socioResult.rows.length === 0) {
            await bot.sendMessage(chatId, "❌ Vendedor no encontrado.");
            delete sesionesConsulta[chatId];
            return;
        }
        
        const socio = socioResult.rows[0];
        const socioUuid = socio.id;
        
        const vendedorTelegramResult = await pool.query(
            `SELECT telegram_chat_id FROM socios WHERE id = $1`,
            [socioUuid]
        );
        const vendedorTelegramId = vendedorTelegramResult.rows[0]?.telegram_chat_id;
        
        const conversacionesResult = await pool.query(
            `SELECT COUNT(DISTINCT cliente_id) as total_clientes 
             FROM conversaciones WHERE vendedor_id = $1`,
            [String(vendedorTelegramId)]
        );
        const totalClientes = conversacionesResult.rows[0]?.total_clientes || 0;
        
        const productosResult = await pool.query(
            `SELECT COUNT(*) as vendidos 
             FROM productos_socios WHERE socio_id = $1 AND estado = 'vendido'`,
            [socioUuid]
        );
        const productosVendidos = productosResult.rows[0]?.vendidos || 0;
        
        const mensajesResult = await pool.query(
            `SELECT COUNT(*) as total_mensajes 
             FROM conversaciones WHERE vendedor_id = $1 AND remitente = 'vendedor'`,
            [String(vendedorTelegramId)]
        );
        const totalMensajes = mensajesResult.rows[0]?.total_mensajes || 0;
        
        const calificacion = parseFloat(socio.estrellas) || 0;
        
        const mensajesRecientes = await pool.query(
            `SELECT remitente, mensaje, created_at 
             FROM conversaciones 
             WHERE vendedor_id = $1 
             ORDER BY created_at DESC 
             LIMIT 10`,
            [String(vendedorTelegramId)]
        );

        let historialMensajes = "";
        for (const m of mensajesRecientes.rows) {
            historialMensajes += `[${m.remitente}]: ${m.mensaje}\n`;
        }

        const contexto = `
VENDEDOR: ${socio.nombre}
CALIFICACIÓN: ${calificacion.toFixed(1)} ★ (basada en ${socio.total_calificaciones || 0} calificaciones)
PRODUCTOS VENDIDOS: ${productosVendidos}
CLIENTES ATENDIDOS: ${totalClientes}
MENSAJES ENVIADOS: ${totalMensajes}

ÚLTIMOS MENSAJES DE LA CONVERSACIÓN:
${historialMensajes}

Responde la pregunta del usuario de forma amigable y útil, basándote en estos datos reales y en el contenido de los mensajes.
`;
        
        const respuestaIA = await consultarDeepSeek(texto, contexto);
        
        const botonesContinuar = {
            reply_markup: {
                inline_keyboard: [
                    [{ text: "🔍 Hacer otra pregunta", callback_data: `seguir_preguntando_${socioNumId}` }],
                    [{ text: "❌ Salir", callback_data: `salir_consulta_${socioNumId}` }]
                ]
            }
        };
        
        await bot.sendMessage(chatId, 
            `🤖 *Respuesta sobre ${socio.nombre}:*\n\n${respuestaIA}`,
            { parse_mode: "Markdown", ...botonesContinuar }
        );
        
        delete sesionesConsulta[chatId];
        console.log(`✅ [IA HANDLER] Respuesta enviada, sesión eliminada`);
        return;
        
    } catch (error) {
        console.error("Error en consulta IA:", error);
        await bot.sendMessage(chatId, "❌ Error al procesar tu pregunta. Intenta de nuevo.");
        delete sesionesConsulta[chatId];
        return;
    }
});

console.log("🎯 BotMatch Socio iniciado...");
console.log("🎯 BotMatch Socio iniciado...");