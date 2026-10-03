// เก็บ/อ่าน/ลบ ข้อมูล (โฟลเดอร์ รายการ ฯลฯ) เป็นไฟล์ JSON ใน Vercel Blob
import { put, list, del } from '@vercel/blob';

const STORES = new Set(['folders', 'items', 'blobs', 'meta']);
const safe = (k) => String(k).replace(/[^\w-]/g, '_');
const rowPath = (s, k) => `kv/${s}/${safe(k)}.json`;

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
const readJson = async (url) => (await fetch(`${url}?t=${Date.now()}`)).json();

export default async function handler(req, res) {
  try {
    const q = req.query || {};
    if (q.ping) return res.status(200).json({ ok: true });
    const store = q.store || (req.body && req.body.store);
    if (!STORES.has(store)) return res.status(400).json({ error: 'bad store' });

    if (req.method === 'GET') {
      if (q.k) {
        const path = rowPath(store, q.k);
        const b = (await listAll(path)).find((x) => x.pathname === path);
        return res.status(200).json(b ? await readJson(b.url) : null);
      }
      const blobs = await listAll(`kv/${store}/`);
      return res.status(200).json(await Promise.all(blobs.map((b) => readJson(b.url))));
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
      const path = rowPath(store, q.k);
      const b = (await listAll(path)).find((x) => x.pathname === path);
      if (b) {
        const data = await readJson(b.url);
        const urls = Object.values(data).filter((m) => m && m.__blob).map((m) => m.__blob);
        await del([b.url, ...urls]);
      }
      return res.status(200).json({ ok: true });
    }

    res.status(405).json({ error: 'method not allowed' });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}
