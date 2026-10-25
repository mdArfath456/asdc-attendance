const bcrypt = require('bcryptjs');
const env = require('../../config/env');

const hashPassword = (plain) => bcrypt.hash(plain, env.BCRYPT_COST);
const verifyPassword = (plain, hash) => bcrypt.compare(plain, hash);
let dummy;
// Compared when the user does not exist, so response timing does not reveal valid emails.
const dummyHash = async () => (dummy ||= await bcrypt.hash('not-a-real-password', env.BCRYPT_COST));

module.exports = { hashPassword, verifyPassword, dummyHash };
