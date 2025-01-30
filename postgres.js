import pg from 'pg';  // Import pg module
const { Client } = pg;  // Destructure Client from pg module
import { logger } from './winston.js';

import dotenv from 'dotenv';

if (process.env.BOTENV != "PRODUCTION") {
  // Load environment variables from .env.dev if not production
  dotenv.config({path: '.env.dev'});
}
const pgClient = new Client({
  host: process.env.DATABASE_HOST,
  port: process.env.DATA,
  user: process.env.DATABASE_USER,
  password: process.env.DATABASE_PASSWORD,
  database: process.env.DATABASE_NAME
});

const connectDb = async () => {
  try {
    await pgClient.connect();
    logger.logWithContext('info','Connected to the database');
  } catch (error) {
    logger.logWithContext('error','Error connecting to the database:', error.stack);
  }
};

const disconnectDb = async () => {
  try {
    await pgClient.end();
    logger.logWithContext('info','Disconnected from the database');
  } catch (error) {
    logger.logWithContext('error','Error disconnecting from the database:', error.stack);
  }
};

export { connectDb, disconnectDb, pgClient };
