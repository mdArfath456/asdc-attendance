Object.assign(process.env, {
  NODE_ENV: 'test',
  MONGO_URI: 'mongodb://placeholder/asdc',
  JWT_ACCESS_SECRET: 'test-access-secret-test-access-secret-0000',
  QR_SIGNING_SECRET: 'test-qr-secret-test-qr-secret-test-qr-0000',
  GOOGLE_CLIENT_ID: 'test-client-id.apps.googleusercontent.com',
  ADMIN_EMAIL: 'admin@asdc.test',
  ADMIN_PASSWORD: 'test-admin-password-123!',
  BCRYPT_COST: '4',
});
