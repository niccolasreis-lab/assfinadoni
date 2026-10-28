export default function handler(_req, res) {
  res.setHeader('Cache-Control', 'no-store');
  res.status(200).json({
    version_code: Number(process.env.ANDROID_VERSION_CODE || 2),
    version_name: process.env.ANDROID_VERSION_NAME || '1.1.0',
    download_url: process.env.ANDROID_APK_URL || '',
    sha256: process.env.ANDROID_APK_SHA256 || '',
    size_bytes: Number(process.env.ANDROID_APK_SIZE_BYTES || 0),
    release_notes: (process.env.ANDROID_RELEASE_NOTES || '').slice(0, 2000),
  });
}

