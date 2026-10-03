// ออก token ให้เบราว์เซอร์อัพโหลดรูปตรงเข้า Vercel Blob (รองรับไฟล์ใหญ่กว่า 4.5MB)
import { handleUpload } from '@vercel/blob/client';

export default async function handler(req, res) {
  try {
    const json = await handleUpload({
      body: req.body,
      request: req,
      onBeforeGenerateToken: async (pathname) => {
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
    res.status(400).json({ error: e.message });
  }
}
