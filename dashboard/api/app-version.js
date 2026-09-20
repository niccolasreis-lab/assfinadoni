export default function handler(_req, res) {
  res.setHeader('Cache-Control', 'no-store');
  res.status(200).json({
    version_code: Number(process.env.ANDROID_VERSION_CODE || 2),
    version_name: process.env.ANDROID_VERSION_NAME || '1.1.0',
    download_url: process.env.ANDROID_APK_URL || '',
  });
}

