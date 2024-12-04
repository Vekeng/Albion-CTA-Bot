import pg from 'pg';  // Import pg module
const { Client } = pg;  // Destructure Client from pg module

const pgClient = new Client({
  host: 'localhost',
  port: 5432,
  user: 'postgres',
  password: 'mysecretpassword',
  database: 'ctabot'
});

const connectDb = async () => {
  try {
    await pgClient.connect();
    console.log('Connected to the database');
  } catch (error) {
    console.error('Error connecting to the database:', error.stack);
  }
};

const disconnectDb = async () => {
  try {
    await pgClient.end();
    console.log('Disconnected from the database');
  } catch (error) {
    console.error('Error disconnecting from the database:', error.stack);
  }
};

const checkEvent = async (eventId, guildId) => {
  const selectEventQuery = `SELECT * FROM events WHERE event_id=$1 and discord_id=$2;`;
  const selectResult = await pgClient.query(selectEventQuery, [eventId, guildId]);
  const eventCount = selectResult.rowCount;
  return eventCount;
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

}

export { botQueries, checkEvent, connectDb, disconnectDb, pgClient };
