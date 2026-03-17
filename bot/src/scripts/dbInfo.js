const mongoose = require('mongoose');
const dotenv = require('dotenv');
const { z } = require('zod');
const { logger } = require('../config/logger');

dotenv.config();

const schema = z.object({
  MONGODB_URI: z.string().min(1)
});

async function main() {
  const parsed = schema.safeParse(process.env);
  if (!parsed.success) {
    logger.error({ issues: parsed.error.issues }, 'Invalid environment variables for db:info');
    process.exit(1);
  }

  const { MONGODB_URI } = parsed.data;
  await mongoose.connect(MONGODB_URI);

  const db = mongoose.connection.db;
  const name = mongoose.connection.name;
  const cols = await db.listCollections().toArray();

  logger.info({ database: name, collections: cols.map((c) => c.name).sort() }, 'MongoDB info');

  await mongoose.disconnect();
}

main().catch((err) => {
  logger.error({ err }, 'db:info failed');
  process.exit(1);
});

