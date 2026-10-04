// เก็บ/อ่าน/ลบ ข้อมูล (โฟลเดอร์ รายการ ฯลฯ) เป็นไฟล์ JSON ใน Vercel Blob
// ต้องตั้ง Environment Variable APP_KEY ใน Vercel ไม่งั้นทุกคำขอจะถูกปฏิเสธ (401)
import { put, list, del } from '@vercel/blob';

const STORES = new Set(['folders', 'items', 'blobs', 'meta']);
const safe = (k) => String(k).replace(/[^\w-]/g, '_');
const rowPath = (s, k) => `kv/${s}/${safe(k)}.json`;

// สร้าง URL ตรงจาก store id ใน token (vercel_blob_rw_<STOREID>_<secret>)
// จะได้อ่านแถวเดียวโดยไม่ต้อง list() ซึ่งนับเป็น Advanced operation
const baseUrl = () => {
  const id = (process.env.BLOB_READ_WRITE_TOKEN || '').split('_')[3];
  return id ? `https://${id.toLowerCase()}.public.blob.vercel-storage.com` : null;
};

async function listAll(prefix) {
  let cursor, out = [];
  do {
    const r = await list({ prefix, cursor, limit: 1000 });
    out.push(...r.blobs);
    cursor = r.hasMore ? r.cursor : undefined;
  } while (cursor);
  return out;
}

// ใส่ ?t= กัน CDN ส่งข้อมูลเก่า
async function readJson(url) {
  const r = await fetch(`${url}?t=${Date.now()}`);
  return r.ok ? r.json() : null;
}

// หาแถวเดียว: ลองอ่านตรงก่อน (ไม่นับ Advanced op) ถ้าไม่ได้ค่อย fallback ไป list()
async function findOne(path) {
  const base = baseUrl();
  if (base) {
    try {
      const url = `${base}/${path}`;
      const r = await fetch(`${url}?t=${Date.now()}`);
      if (r.status === 404) return null;
      if (r.ok) return { url, data: await r.json() };
    } catch (e) {
      /* ตกไปใช้ list ด้านล่าง */
    }
  }
  const b = (await listAll(path)).find((x) => x.pathname === path);
  return b ? { url: b.url, data: await readJson(b.url) } : null;
}

// อ่านทีละกลุ่ม ไม่ยิงพร้อมกันทั้งร้อย
async function mapLimit(arr, n, fn) {
  const out = [];
  for (let i = 0; i < arr.length; i += n) out.push(...(await Promise.all(arr.slice(i, i + n).map(fn))));
  return out;
}

// ลบเฉพาะไฟล์รูปของเราเอง (files/...) กันแถวปลอมชี้ไปลบไฟล์อื่น
const ownFile = (u) => {
  try {
    const x = new URL(u);
    return x.hostname.endsWith('.blob.vercel-storage.com') && x.pathname.startsWith('/files/');
  } catch (e) {
    return false;
  }
};

export default async function handler(req, res) {
  try {
    const key = process.env.APP_KEY;
    if (!key || req.headers['x-app-key'] !== key) return res.status(401).json({ error: 'unauthorized' });

    const q = req.query || {};
    if (q.ping) return res.status(200).json({ ok: true });
    const store = q.store || (req.body && req.body.store);
    if (!STORES.has(store)) return res.status(400).json({ error: 'bad store' });

    if (req.method === 'GET') {
      if (q.k) {
        const found = await findOne(rowPath(store, q.k));
        return res.status(200).json(found ? found.data : null);
      }
      const blobs = await listAll(`kv/${store}/`);
      const rows = await mapLimit(blobs, 25, (b) => readJson(b.url));
      return res.status(200).json(rows.filter(Boolean));
    }

    if (req.method === 'PUT') {
      const { k, data } = req.body || {};
      if (k == null || !data) return res.status(400).json({ error: 'bad body' });
      await put(rowPath(store, k), JSON.stringify(data), {
        access: 'public',
        contentType: 'application/json',
        allowOverwrite: true,
        addRandomSuffix: false,
        cacheControlMaxAge: 60,
      });
      return res.status(200).json({ ok: true });
    }

    if (req.method === 'DELETE') {
      if (q.k == null) return res.status(400).json({ error: 'bad key' });
      const found = await findOne(rowPath(store, q.k));
      if (found) {
        const urls = Object.values(found.data || {})
          .filter((m) => m && m.__blob && ownFile(m.__blob))
          .map((m) => m.__blob);
        await del([found.url, ...urls]);
      }
      return res.status(200).json({ ok: true });
    }

    res.status(405).json({ error: 'method not allowed' });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}