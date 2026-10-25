const User = require('../users/user.model');
const env = require('../../config/env');
const { ROLES } = require('../../utils/constants');
const { hashPassword } = require('./password');
const bcrypt = require('bcryptjs');

async function bootstrapAdmin() {
  await User.updateMany(
    { email: { $ne: env.ADMIN_EMAIL }, role: 'ADMIN' },
    { $set: { role: 'TRAINER' } }
  );
  await User.updateMany(
    { email: { $ne: env.ADMIN_EMAIL }, role: { $nin: [...ROLES, 'ADMIN'] } },
    { $set: { role: 'TRAINER' } }
  );

  let admin = await User.findOne({ email: env.ADMIN_EMAIL }).select('+passwordHash');
  const authProviders = env.ADMIN_PASSWORD ? ['GOOGLE', 'LOCAL'] : ['GOOGLE'];
  const passwordHash = env.ADMIN_PASSWORD
    ? admin && admin.passwordHash && await bcrypt.compare(env.ADMIN_PASSWORD, admin.passwordHash)
      ? admin.passwordHash
      : await hashPassword(env.ADMIN_PASSWORD)
    : undefined;

  if (!admin) {
    admin = await User.create({
      name: env.ADMIN_EMAIL.split('@')[0],
      email: env.ADMIN_EMAIL,
      role: 'ADMIN',
      authProviders,
      ...(passwordHash ? { passwordHash } : {}),
    });
  } else {
    admin.role = 'ADMIN';
    admin.authProviders = authProviders;
    if (passwordHash) admin.passwordHash = passwordHash;
    else admin.passwordHash = undefined;
    await admin.save();
  }
  return admin;
}

module.exports = { bootstrapAdmin };
