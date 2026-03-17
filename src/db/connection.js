const mongoose = require('mongoose');
const { logger } = require('../config/logger');

async function connectToDatabase(uri) {
  mongoose.set('strictQuery', true);
  mongoose.connection.on('error', (err) => {
    logger.error({ err }, 'MongoDB connection error');
  });
  mongoose.connection.on('connected', () => {
    logger.info('MongoDB connected');
  });

  await mongoose.connect(uri);
}

module.exports = { connectToDatabase };

