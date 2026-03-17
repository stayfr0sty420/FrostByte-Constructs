const mongoose = require('mongoose');

function isTransactionUnsupportedError(err) {
  const msg = String(err?.message || '');
  return (
    msg.includes('Transaction numbers are only allowed') ||
    msg.includes('Transactions are not supported') ||
    msg.includes('replica set member') ||
    msg.includes('mongos')
  );
}

async function withOptionalTransaction(work) {
  const session = await mongoose.startSession();
  try {
    let result;
    try {
      await session.withTransaction(async () => {
        result = await work(session);
      });
      return result;
    } catch (err) {
      if (isTransactionUnsupportedError(err)) return await work(null);
      throw err;
    }
  } finally {
    await session.endSession();
  }
}

module.exports = { withOptionalTransaction };
