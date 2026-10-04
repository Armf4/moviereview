// ออก token ให้เบราว์เซอร์อัพโหลดรูปตรงเข้า Vercel Blob (รองรับไฟล์ใหญ่กว่า 4.5MB)
// ต้องตั้ง Environment Variable APP_KEY ใน Vercel (หน้าเว็บส่งมาทาง clientPayload)
import { handleUpload } from '@vercel/blob/client';

export default async function handler(req, res) {
  try {
    const json = await handleUpload({
      body: req.body,
      request: req,
      onBeforeGenerateToken: async (pathname, clientPayload) => {
        const key = process.env.APP_KEY;
        if (!key || clientPayload !== key) throw new Error('unauthorized');
        if (!pathname.startsWith('files/')) throw new Error('invalid path');
        return {
          allowedContentTypes: ['image/*'],
          maximumSizeInBytes: 30 * 1024 * 1024,
          addRandomSuffix: false,
          allowOverwrite: true,
        };
      },
    });
    res.status(200).json(json);
  } catch (e) {
    res.status(e.message === 'unauthorized' ? 401 : 400).json({ error: e.message });
  }
}