require('dotenv').config();
const express = require('express');
const cors    = require('cors');
const { createClient } = require('@supabase/supabase-js');

const app  = express();
const PORT = process.env.PORT || 3000;

/* ============================================================
   SUPABASE — pakai service_role_key agar bisa akses semua data
   ============================================================ */
const supabaseAdmin = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { autoRefreshToken: false, persistSession: false } }
);

/* ============================================================
   MIDDLEWARE
   ============================================================ */
app.use(express.json());
app.use(cors({
  origin: [
    process.env.FRONTEND_URL || 'https://athena-ai-tawny.vercel.app',
    'http://localhost:3000',
    'http://127.0.0.1:5500'
  ],
  methods: ['GET','POST','PUT','DELETE','OPTIONS'],
  allowedHeaders: ['Content-Type','Authorization','x-admin-token'],
  credentials: true
}));

/* ============================================================
   MIDDLEWARE — verifikasi token admin
   Setiap request ke /api/admin/* harus menyertakan header:
   Authorization: Bearer <access_token dari Supabase session>
   ============================================================ */
async function requireAdmin(req, res, next) {
  const authHeader = req.headers['authorization'];
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Token tidak ditemukan.' });
  }
  const token = authHeader.replace('Bearer ', '');
  try {
    const { data, error } = await supabaseAdmin.auth.getUser(token);
    if (error || !data.user) return res.status(401).json({ error: 'Token tidak valid.' });

    const ADMIN_EMAILS = (process.env.ADMIN_EMAILS || '').split(',').map(e => e.trim().toLowerCase());
    if (!ADMIN_EMAILS.includes(data.user.email.toLowerCase())) {
      return res.status(403).json({ error: 'Akses ditolak. Bukan admin.' });
    }
    req.adminUser = data.user;
    next();
  } catch (e) {
    return res.status(500).json({ error: 'Verifikasi token gagal.' });
  }
}

/* ============================================================
   HEALTH CHECK
   ============================================================ */
app.get('/', (req, res) => {
  res.json({ status: 'ok', service: 'Athena AI Backend', version: '1.0.0' });
});

/* ============================================================
   USER MANAGEMENT
   ============================================================ */

// GET /api/admin/users — ambil semua user
app.get('/api/admin/users', requireAdmin, async (req, res) => {
  try {
    const { data, error } = await supabaseAdmin.auth.admin.listUsers({ page: 1, perPage: 1000 });
    if (error) throw error;

    const ADMIN_EMAILS = (process.env.ADMIN_EMAILS || '').split(',').map(e => e.trim().toLowerCase());
    const users = data.users.map(u => ({
      id:         u.id,
      email:      u.email,
      name:       u.user_metadata?.name || u.email?.split('@')[0] || '-',
      role:       ADMIN_EMAILS.includes(u.email?.toLowerCase()) ? 'admin' : 'user',
      status:     u.banned_until ? 'banned' : 'active',
      created_at: u.created_at,
      last_sign_in: u.last_sign_in_at,
      confirmed:  !!u.confirmed_at
    }));

    res.json({ users, total: users.length });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// PUT /api/admin/users/:id/ban — ban user
app.put('/api/admin/users/:id/ban', requireAdmin, async (req, res) => {
  try {
    const { data, error } = await supabaseAdmin.auth.admin.updateUserById(req.params.id, {
      ban_duration: req.body.duration || '87600h' // default 10 tahun = banned permanen
    });
    if (error) throw error;
    res.json({ success: true, user: data.user });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// PUT /api/admin/users/:id/unban — unban user
app.put('/api/admin/users/:id/unban', requireAdmin, async (req, res) => {
  try {
    const { data, error } = await supabaseAdmin.auth.admin.updateUserById(req.params.id, {
      ban_duration: 'none'
    });
    if (error) throw error;
    res.json({ success: true, user: data.user });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// DELETE /api/admin/users/:id — hapus user
app.delete('/api/admin/users/:id', requireAdmin, async (req, res) => {
  try {
    const { error } = await supabaseAdmin.auth.admin.deleteUser(req.params.id);
    if (error) throw error;
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

/* ============================================================
   CONVERSATIONS — simpan & ambil dari tabel Supabase
   Buat tabel ini di Supabase SQL Editor:

   CREATE TABLE conversations (
     id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
     user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE,
     user_email text,
     user_name text,
     mode text,
     messages jsonb DEFAULT '[]',
     last_message text,
     created_at timestamptz DEFAULT now(),
     updated_at timestamptz DEFAULT now()
   );

   ALTER TABLE conversations ENABLE ROW LEVEL SECURITY;
   CREATE POLICY "Users can manage own conversations"
     ON conversations FOR ALL USING (auth.uid() = user_id);
   CREATE POLICY "Admins can read all conversations"
     ON conversations FOR SELECT USING (true);
   ============================================================ */

// POST /api/conversations — simpan percakapan (dipanggil dari frontend setelah user chat)
app.post('/api/conversations', async (req, res) => {
  const authHeader = req.headers['authorization'];
  if (!authHeader) return res.status(401).json({ error: 'Token diperlukan.' });
  const token = authHeader.replace('Bearer ', '');
  try {
    const { data: userData } = await supabaseAdmin.auth.getUser(token);
    if (!userData.user) return res.status(401).json({ error: 'Token tidak valid.' });

    const { mode, messages, last_message } = req.body;
    const { data, error } = await supabaseAdmin.from('conversations').insert({
      user_id:      userData.user.id,
      user_email:   userData.user.email,
      user_name:    userData.user.user_metadata?.name || userData.user.email?.split('@')[0],
      mode,
      messages,
      last_message,
      updated_at:   new Date().toISOString()
    }).select().single();
    if (error) throw error;
    res.json({ success: true, conversation: data });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// GET /api/admin/conversations — ambil semua percakapan (admin only)
app.get('/api/admin/conversations', requireAdmin, async (req, res) => {
  try {
    const { data, error } = await supabaseAdmin
      .from('conversations')
      .select('*')
      .order('updated_at', { ascending: false })
      .limit(200);
    if (error) throw error;
    res.json({ conversations: data, total: data.length });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// DELETE /api/admin/conversations/:id — hapus percakapan
app.delete('/api/admin/conversations/:id', requireAdmin, async (req, res) => {
  try {
    const { error } = await supabaseAdmin.from('conversations').delete().eq('id', req.params.id);
    if (error) throw error;
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

/* ============================================================
   BROADCAST — simpan pesan broadcast ke tabel
   Buat tabel:

   CREATE TABLE broadcasts (
     id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
     message text NOT NULL,
     type text DEFAULT 'info',
     active boolean DEFAULT true,
     created_by text,
     created_at timestamptz DEFAULT now()
   );
   ============================================================ */

// GET /api/broadcast — ambil broadcast aktif (publik, dipanggil frontend)
app.get('/api/broadcast', async (req, res) => {
  try {
    const { data, error } = await supabaseAdmin
      .from('broadcasts')
      .select('*')
      .eq('active', true)
      .order('created_at', { ascending: false })
      .limit(1)
      .single();
    if (error && error.code !== 'PGRST116') throw error;
    res.json({ broadcast: data || null });
  } catch (e) {
    res.json({ broadcast: null });
  }
});

// POST /api/admin/broadcast — kirim broadcast baru
app.post('/api/admin/broadcast', requireAdmin, async (req, res) => {
  try {
    // Nonaktifkan broadcast sebelumnya
    await supabaseAdmin.from('broadcasts').update({ active: false }).eq('active', true);

    const { message, type } = req.body;
    const { data, error } = await supabaseAdmin.from('broadcasts').insert({
      message,
      type: type || 'info',
      created_by: req.adminUser.email
    }).select().single();
    if (error) throw error;
    res.json({ success: true, broadcast: data });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// DELETE /api/admin/broadcast — hapus semua broadcast aktif
app.delete('/api/admin/broadcast', requireAdmin, async (req, res) => {
  try {
    await supabaseAdmin.from('broadcasts').update({ active: false }).eq('active', true);
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

/* ============================================================
   START SERVER
   ============================================================ */
app.listen(PORT, () => {
  console.log(`✅ Athena AI Backend berjalan di port ${PORT}`);
});
