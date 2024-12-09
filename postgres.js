import pg from 'pg';  // Import pg module
const { Client } = pg;  // Destructure Client from pg module
import { logger } from './winston.js';

import dotenv from 'dotenv';

dotenv.config();

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

const botQueries = {
  GET_EVENT_PARTICIPANTS : `
    SELECT 
        r.role_id,
        r.role_name,
        r.party,
        p.user_id
    FROM
        roles r
    JOIN
        events e
    ON
        r.comp_name = e.comp_name
        AND r.discord_id = e.discord_id
    LEFT JOIN
        participants p
    ON
        p.role_id = r.role_id
        AND p.discord_id = r.discord_id
        AND p.comp_name = r.comp_name
        AND p.event_id = e.event_id
    WHERE
        e.event_id = $1
    AND
        e.discord_id = $2;
  `, 
  GET_AVAILABLE_PARTIES: `
    SELECT DISTINCT r.party
    FROM
        roles r
    JOIN
        events e
    ON
        r.comp_name = e.comp_name
        AND r.discord_id = e.discord_id
    LEFT JOIN
        participants p
    ON
        p.role_id = r.role_id
        AND p.discord_id = r.discord_id
        AND p.comp_name = r.comp_name
        AND p.event_id = e.event_id
    WHERE
        e.event_id = $1
        AND e.discord_id = $2
        AND p.user_id IS NULL;
  `,
  GET_AVAILABLE_ROLES_IN_PARTY: `
    SELECT r.role_id, r.role_name
    FROM
      roles r
    JOIN
      events e
    ON
      r.comp_name = e.comp_name
      AND r.discord_id = e.discord_id
    LEFT JOIN
      participants p
    ON
      p.role_id = r.role_id
      AND p.discord_id = r.discord_id
      AND p.comp_name = r.comp_name
    AND p.event_id = e.event_id
    WHERE
      e.event_id = $1
      AND e.discord_id = $2
      AND p.user_id IS NULL
      AND r.party = $3;
  `, 
  INSERT_EVENT: `
    INSERT INTO events (event_id, event_name, user_id, discord_id, comp_name, date, time_utc)
    VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING event_id;
  `, 
  GET_EVENT: `SELECT * FROM events WHERE event_id=$1 AND discord_id=$2`, 

  GET_MYCTAS: `
    SELECT 
      e.event_id,
      e.event_name,
      e.date,
      e.time_utc,
      r.role_id,
      r.role_name,
      r.party
    FROM 
        participants p
    JOIN 
        events e 
        ON p.event_id = e.event_id AND p.discord_id = e.discord_id
    JOIN 
        roles r 
        ON p.role_id = r.role_id 
        AND p.comp_name = r.comp_name 
        AND p.discord_id = r.discord_id
    WHERE 
        p.user_id = $1
        AND p.discord_id = $2;
    `
}

export { botQueries, connectDb, disconnectDb, pgClient };
