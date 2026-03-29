const AdminLog = require('../../db/models/AdminLog');

async function createAdminLog({
  adminId = null,
  email = '',
  ipAddress = '',
  userAgent = '',
  status = 'failed',
  stage = 'login',
  reason = ''
}) {
  await AdminLog.create({
    adminId,
    email: String(email || '').trim().toLowerCase(),
    ipAddress: String(ipAddress || '').trim(),
    userAgent: String(userAgent || '').trim(),
    status,
    stage,
    reason: String(reason || '').trim()
  });
}

module.exports = {
  createAdminLog
};
