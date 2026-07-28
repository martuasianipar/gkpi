require('dotenv').config();
const express = require('express');
const mysql = require('mysql2/promise');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static(__dirname));

// Database connection pool
let pool;

async function initDb() {
  try {
    pool = mysql.createPool({
      host: process.env.DB_HOST || 'localhost',
      user: process.env.DB_USER || 'root',
      password: process.env.DB_PASSWORD || '',
      database: process.env.DB_NAME || 'gkpi_pekanbaru',
      waitForConnections: true,
      connectionLimit: 10,
      queueLimit: 0
    });
    // Test the connection
    await pool.query('SELECT 1');
    await pool.query("UPDATE jemaat SET status_keanggotaan = 'Aktif' WHERE status_keanggotaan IS NULL");
    console.log('Successfully connected to MySQL database');
  } catch (error) {
    console.error('Database connection failed:', error.message);
    process.exit(1);
  }
}

// Map database row to frontend member object
function mapRowToMember(row) {
  return {
    id: row.id,
    number: row.no_jemaat,
    name: row.nama,
    status: row.status_keluarga,
    gender: row.jenis_kelamin,
    address: row.alamat,
    sector: row.sektor_nama,
    birthDate: row.tanggal_lahir ? formatDate(row.tanggal_lahir) : '',
    baptismDate: row.tanggal_baptis ? formatDate(row.tanggal_baptis) : '',
    confirmationDate: row.tanggal_sidi ? formatDate(row.tanggal_sidi) : '',
    marriageDate: row.tanggal_nikah ? formatDate(row.tanggal_nikah) : '',
    familyId: row.family_id,
    enteredAt: row.entered_at ? row.entered_at.toISOString() : ''
  };
}

// Map database row to frontend left member object
function mapRowToLeftMember(row) {
  return {
    id: row.id,
    number: row.no_jemaat,
    name: row.nama,
    status: row.status_keluarga,
    gender: row.jenis_kelamin,
    address: row.alamat,
    sector: row.sektor_nama,
    birthDate: row.tanggal_lahir ? formatDate(row.tanggal_lahir) : '',
    baptismDate: row.tanggal_baptis ? formatDate(row.tanggal_baptis) : '',
    confirmationDate: row.tanggal_sidi ? formatDate(row.tanggal_sidi) : '',
    marriageDate: row.tanggal_nikah ? formatDate(row.tanggal_nikah) : '',
    familyId: row.family_id,
    leftId: row.id,
    reason: row.status_keanggotaan,
    leftDate: row.tanggal_keluar ? formatDate(row.tanggal_keluar) : '',
    notes: row.catatan_keluar || ''
  };
}

function formatDate(dateVal) {
  if (!dateVal) return '';
  const d = new Date(dateVal);
  if (isNaN(d.getTime())) return '';
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

// Helper to convert empty string to null for SQL dates
function nullIfEmpty(val) {
  return val && val.trim() !== '' ? val : null;
}

// API Routes

// Health check for the frontend and quick local diagnostics.
app.get('/api/health', async (req, res) => {
  try {
    await pool.query('SELECT 1');
    res.json({ ok: true });
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
});

// Get all sectors
app.get('/api/sectors', async (req, res) => {
  try {
    const [rows] = await pool.query('SELECT nama FROM sektor ORDER BY id');
    res.json(rows.map(r => r.nama));
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get active members
app.get('/api/members', async (req, res) => {
  try {
    const sector = req.query.sector;
    let query = "SELECT * FROM jemaat WHERE (status_keanggotaan = 'Aktif' OR status_keanggotaan IS NULL)";
    const params = [];

    if (sector && sector !== 'all') {
      query += ' AND sektor_nama = ?';
      params.push(sector);
    }

    const [rows] = await pool.query(query, params);
    res.json(rows.map(mapRowToMember));
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get new members (entered within 30 days)
app.get('/api/new-members', async (req, res) => {
  try {
    const [rows] = await pool.query(
      "SELECT * FROM jemaat WHERE (status_keanggotaan = 'Aktif' OR status_keanggotaan IS NULL) AND entered_at >= NOW() - INTERVAL 30 DAY"
    );
    res.json(rows.map(mapRowToMember));
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get left (pindah/meninggal) members
app.get('/api/left-members', async (req, res) => {
  try {
    const [rows] = await pool.query(
      "SELECT * FROM jemaat WHERE status_keanggotaan IN ('Pindah', 'Meninggal')"
    );
    res.json(rows.map(mapRowToLeftMember));
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Add new member
app.post('/api/members', async (req, res) => {
  try {
    const m = req.body;
    const query = `
      INSERT INTO jemaat (
        id, no_jemaat, nama, status_keluarga, jenis_kelamin, alamat, sektor_nama,
        tanggal_lahir, tanggal_baptis, tanggal_sidi, tanggal_nikah, family_id, entered_at,
        status_keanggotaan
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `;
    const enteredAt = m.enteredAt ? new Date(m.enteredAt) : new Date();
    await pool.query(query, [
      m.id,
      m.number,
      m.name,
      m.status || 'Aktif',
      m.gender,
      m.address || null,
      m.sector,
      nullIfEmpty(m.birthDate),
      nullIfEmpty(m.baptismDate),
      nullIfEmpty(m.confirmationDate),
      nullIfEmpty(m.marriageDate),
      m.familyId,
      enteredAt,
      'Aktif'
    ]);

    // Fetch and return the newly created member
    const [[newRow]] = await pool.query('SELECT * FROM jemaat WHERE id = ?', [m.id]);
    res.status(201).json(mapRowToMember(newRow));
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Edit member
app.put('/api/members/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const m = req.body;
    const query = `
      UPDATE jemaat SET
        no_jemaat = ?,
        nama = ?,
        status_keluarga = ?,
        jenis_kelamin = ?,
        alamat = ?,
        sektor_nama = ?,
        tanggal_lahir = ?,
        tanggal_baptis = ?,
        tanggal_sidi = ?,
        tanggal_nikah = ?,
        family_id = ?
      WHERE id = ?
    `;
    await pool.query(query, [
      m.number,
      m.name,
      m.status || null,
      m.gender,
      m.address || null,
      m.sector,
      nullIfEmpty(m.birthDate),
      nullIfEmpty(m.baptismDate),
      nullIfEmpty(m.confirmationDate),
      nullIfEmpty(m.marriageDate),
      m.familyId,
      id
    ]);

    const [[updatedRow]] = await pool.query('SELECT * FROM jemaat WHERE id = ?', [id]);
    if (!updatedRow) return res.status(404).json({ error: 'Member not found' });
    res.json(mapRowToMember(updatedRow));
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Delete member permanently
app.delete('/api/members/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const [result] = await pool.query('DELETE FROM jemaat WHERE id = ?', [id]);
    if (result.affectedRows === 0) return res.status(404).json({ error: 'Member not found' });
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Mark member as left (Pindah/Meninggal)
app.post('/api/members/:id/leave', async (req, res) => {
  try {
    const { id } = req.params;
    const { reason, leftDate, notes } = req.body;

    const query = `
      UPDATE jemaat SET
        status_keanggotaan = ?,
        tanggal_keluar = ?,
        catatan_keluar = ?
      WHERE id = ?
    `;
    const [result] = await pool.query(query, [
      reason, // 'Pindah' or 'Meninggal'
      nullIfEmpty(leftDate),
      notes || null,
      id
    ]);

    if (result.affectedRows === 0) return res.status(404).json({ error: 'Member not found' });
    
    const [[updatedRow]] = await pool.query('SELECT * FROM jemaat WHERE id = ?', [id]);
    res.json(mapRowToLeftMember(updatedRow));
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Clear "new member" history without deleting active congregation records.
app.post('/api/cleanup-new-history', (req, res) => {
  pool.query(
    `UPDATE jemaat
     SET entered_at = NOW() - INTERVAL 31 DAY
     WHERE (status_keanggotaan = 'Aktif' OR status_keanggotaan IS NULL)
       AND entered_at >= NOW() - INTERVAL 30 DAY`
  )
    .then(([result]) => {
      res.json({
        success: true,
        cleared: result.affectedRows,
        message: 'Riwayat anggota baru sudah dibersihkan'
      });
    })
    .catch((error) => {
      res.status(500).json({ error: error.message });
    });
});

// Start Server after Database Initialization
initDb().then(() => {
  app.listen(PORT, () => {
    console.log(`Server is running on http://localhost:${PORT}`);
  });
});
