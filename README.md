# Athena AI Backend

Backend server untuk Athena AI — mengelola user, percakapan, dan broadcast via Supabase Admin API.

---

## 📋 Persiapan Supabase — Buat Tabel

Buka **Supabase → SQL Editor** dan jalankan query ini:

```sql
-- Tabel conversations
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
CREATE POLICY "Users manage own" ON conversations FOR ALL USING (auth.uid() = user_id);
CREATE POLICY "Admins read all" ON conversations FOR SELECT USING (true);

-- Tabel broadcasts
CREATE TABLE broadcasts (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  message text NOT NULL,
  type text DEFAULT 'info',
  active boolean DEFAULT true,
  created_by text,
  created_at timestamptz DEFAULT now()
);
```

---

## 🚀 Deploy ke Render

### Langkah 1 — Push ke GitHub (repo baru, terpisah dari frontend)
```
Buat repo baru: athena-ai-backend
Push semua file ini ke repo tersebut
```

### Langkah 2 — Buat Web Service di Render
1. Buka **render.com** → New → **Web Service**
2. Connect repo `athena-ai-backend`
3. Isi pengaturan:
   - **Name**: `athena-ai-backend`
   - **Environment**: `Node`
   - **Build Command**: `npm install`
   - **Start Command**: `npm start`
   - **Plan**: Free

### Langkah 3 — Tambah Environment Variables di Render
Di tab **Environment**, tambahkan:

| Key | Value |
|-----|-------|
| `SUPABASE_URL` | `https://zncsqjbdbfzbzjahormw.supabase.co` |
| `SUPABASE_SERVICE_ROLE_KEY` | *(paste service_role_key kamu)* |
| `ADMIN_EMAILS` | `riskyparama4546@gmail.com,kimlana269@gmail.com,kumenomikuroo@gmail.com` |
| `FRONTEND_URL` | `https://athena-ai-tawny.vercel.app` |

### Langkah 4 — Deploy
Klik **Create Web Service** → tunggu build selesai.
URL backend kamu akan seperti: `https://athena-ai-backend.onrender.com`

---

## 🔗 API Endpoints

| Method | Endpoint | Deskripsi |
|--------|----------|-----------|
| GET | `/` | Health check |
| GET | `/api/admin/users` | Semua user (admin) |
| PUT | `/api/admin/users/:id/ban` | Ban user |
| PUT | `/api/admin/users/:id/unban` | Unban user |
| DELETE | `/api/admin/users/:id` | Hapus user |
| POST | `/api/conversations` | Simpan percakapan |
| GET | `/api/admin/conversations` | Semua percakapan (admin) |
| GET | `/api/broadcast` | Broadcast aktif (publik) |
| POST | `/api/admin/broadcast` | Kirim broadcast |
| DELETE | `/api/admin/broadcast` | Hapus broadcast |
