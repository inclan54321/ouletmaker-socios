const { Pool } = require("pg");

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error("❌ ERROR: DATABASE_URL no está definido");
  throw new Error("DATABASE_URL no definido");
}

const pool = new Pool({ 
  connectionString: DATABASE_URL, 
  ssl: { rejectUnauthorized: false },
  connectionTimeoutMillis: 5000
});

console.log("🧠 Pool de Postgres creado");

async function ensureSchema() {
  console.log("⏳ Revisando esquema...");
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS socios (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        nombre VARCHAR(100) NOT NULL,
        email VARCHAR(255) UNIQUE NOT NULL,
        telefono VARCHAR(20) NOT NULL,
        password_hash TEXT NOT NULL,
        codigo_match VARCHAR(5) UNIQUE,
        estrellas DECIMAL(2,1) DEFAULT 0,
        total_calificaciones INT DEFAULT 0,
        token_sesion TEXT,
        token_expira TIMESTAMPTZ,
        created_at TIMESTAMPTZ DEFAULT now()
      );
    `);
    console.log("✅ Tabla socios lista");
  } catch (err) {
    console.error("❌ Error:", err.message);
  }
}

module.exports = { pool, ensureSchema };