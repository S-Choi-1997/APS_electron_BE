/**
 * PostgreSQL Database Connection Module
 *
 * Manages connection pool and provides query utilities
 */

const { Pool } = require('pg');

// Create connection pool
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 20, // Maximum number of clients in the pool
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 2000,
});

// Log successful connection
pool.on('connect', () => {
  console.log('✓ PostgreSQL client connected');
});

// Log errors
pool.on('error', (err) => {
  console.error('PostgreSQL pool error:', err);
  process.exit(-1);
});

/**
 * Execute a query with error handling and timing
 * @param {string} text - SQL query
 * @param {Array} params - Query parameters
 * @returns {Promise<Object>} Query result
 */
async function query(text, params) {
  const start = Date.now();
  try {
    const res = await pool.query(text, params);
    const duration = Date.now() - start;
    console.log(`[DB] Query executed in ${duration}ms`);
    return res;
  } catch (error) {
    console.error('[DB] Query error:', error);
    throw error;
  }
}

/**
 * Get a client from the pool for transactions
 * Remember to call client.release() when done!
 */
async function getClient() {
  const client = await pool.connect();
  const query = client.query.bind(client);
  const release = client.release.bind(client);

  // Set a timeout of 5 seconds, after which we will log this client's last query
  const timeout = setTimeout(() => {
    console.error('A client has been checked out for more than 5 seconds!');
  }, 5000);

  // Monkey patch the client.release() method to clear our timeout
  client.release = () => {
    clearTimeout(timeout);
    return release();
  };

  return client;
}

/**
 * Test database connection
 */
async function testConnection() {
  try {
    const result = await query('SELECT NOW() as now, current_database() as database');
    console.log('✓ PostgreSQL connected to:', result.rows[0].database);
    console.log('✓ Server time:', result.rows[0].now);
    return true;
  } catch (error) {
    console.error('✗ PostgreSQL connection test failed:', error.message);
    return false;
  }
}

/**
 * Close all connections
 */
async function closePool() {
  await pool.end();
  console.log('✓ PostgreSQL pool closed');
}

module.exports = {
  query,
  getClient,
  testConnection,
  closePool,
  pool,
};
