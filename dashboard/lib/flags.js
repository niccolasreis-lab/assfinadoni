export function featureEnabled(name, fallback = false) {
  const value = process.env[name];
  if (value == null || value === '') return fallback;
  return value === 'true' || value === '1' || value === 'on';
}

export function requireFeature(name) {
  if (!featureEnabled(name)) {
    const error = new Error('Esta funcionalidade está sendo habilitada gradualmente.');
    error.status = 503;
    error.code = 'FEATURE_DISABLED';
    throw error;
  }
}
