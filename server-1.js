require('dotenv').config();
const express = require('express');
const cors    = require('cors');
const { createClient } = require('@supabase/supabase-js');

const app = express();

/* ============================================================
   SUPABASE ADMIN
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
  allowedHeaders: ['Content-Type','Authorization'],
  credentials: true
}));

// Penting untuk Vercel — handle OPTIONS preflight
app.options('*', cors());

/* ============================================================
   HELPER — verifikasi token admin
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
app.get('/api/admin/users', requireAdmin, async (req, res) => {
  try {
    const { data, error } = await supabaseAdmin.auth.admin.listUsers({ page: 1, perPage: 1000 });
    if (error) throw error;
    const ADMIN_EMAILS = (process.env.ADMIN_EMAILS || '').split(',').map(e => e.trim().toLowerCase());
    const users = data.users.map(u => ({
      id:           u.id,
      email:        u.email,
      name:         u.user_metadata?.name || u.email?.split('@')[0] || '-',
      role:         ADMIN_EMAILS.includes(u.email?.toLowerCase()) ? 'admin' : 'user',
      status:       u.banned_until ? 'banned' : 'active',
      created_at:   u.created_at,
      last_sign_in: u.last_sign_in_at,
      confirmed:    !!u.confirmed_at
    }));
    res.json({ users, total: users.length });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.put('/api/admin/users/:id/ban', requireAdmin, async (req, res) => {
  try {
    const { data, error } = await supabaseAdmin.auth.admin.updateUserById(req.params.id, {
      ban_duration: req.body.duration || '87600h'
    });
    if (error) throw error;
    res.json({ success: true, user: data.user });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

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
   CONVERSATIONS
   ============================================================ */
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
   BROADCAST
   ============================================================ */
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

app.post('/api/admin/broadcast', requireAdmin, async (req, res) => {
  try {
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

app.delete('/api/admin/broadcast', requireAdmin, async (req, res) => {
  try {
    await supabaseAdmin.from('broadcasts').update({ active: false }).eq('active', true);
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

/* ============================================================
   EXPORT untuk Vercel Serverless
   Vercel tidak pakai app.listen() — langsung export module
   ============================================================ */
module.exports = app;

// Untuk jalankan lokal (npm start) tetap bisa
if (require.main === module) {
  const PORT = process.env.PORT || 3000;
  app.listen(PORT, () => console.log(`✅ Athena AI Backend berjalan di port ${PORT}`));
}
