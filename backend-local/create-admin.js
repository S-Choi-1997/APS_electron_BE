/**
 * Create Admin User Script
 *
 * 관리자 계정을 생성하는 스크립트입니다.
 *
 * 사용법:
 *   node create-admin.js <email> <password> [displayName]
 *
 * 예시:
 *   node create-admin.js admin@example.com MyPassword123 "관리자"
 */

const bcrypt = require('bcrypt');
const { Pool } = require('pg');
const path = require('path');

// Load environment variables
require('dotenv').config({ path: path.join(__dirname, '.env') });

const BCRYPT_ROUNDS = 12;

// PostgreSQL connection
const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: process.env.DB_PORT || 5432,
  database: process.env.DB_NAME || 'aps_admin',
  user: process.env.DB_USER || 'aps_user',
  password: process.env.DB_PASSWORD || 'aps_password',
});

async function createAdminUser(email, password, displayName) {
  const client = await pool.connect();

  try {
    console.log(`[Create Admin] Creating admin user: ${email}`);

    // Check if user already exists
    const checkQuery = 'SELECT email FROM users WHERE email = $1';
    const existing = await client.query(checkQuery, [email]);

    if (existing.rows.length > 0) {
      console.error(`❌ Error: User ${email} already exists`);
      process.exit(1);
    }

    // Hash password
    console.log('[Create Admin] Hashing password...');
    const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);

    // Insert user
    const insertQuery = `
      INSERT INTO users (email, display_name, password_hash, provider, role, active)
      VALUES ($1, $2, $3, 'local', 'admin', true)
      RETURNING email, display_name, role, created_at
    `;

    const result = await client.query(insertQuery, [
      email,
      displayName || email,
      passwordHash,
    ]);

    const user = result.rows[0];

    console.log('\n✅ Admin user created successfully!');
    console.log('-----------------------------------');
    console.log(`Email:        ${user.email}`);
    console.log(`Display Name: ${user.display_name}`);
    console.log(`Role:         ${user.role}`);
    console.log(`Created At:   ${user.created_at}`);
    console.log('-----------------------------------\n');

    return user;
  } catch (error) {
    console.error('❌ Failed to create admin user:', error.message);
    throw error;
  } finally {
    client.release();
  }
}

async function main() {
  const args = process.argv.slice(2);

  if (args.length < 2) {
    console.error('Error: Email and password are required');
    console.log('\nUsage:');
    console.log('  node create-admin.js <email> <password> [displayName]');
    console.log('\nExample:');
    console.log('  node create-admin.js admin@example.com MyPassword123 "관리자"');
    process.exit(1);
  }

  const email = args[0];
  const password = args[1];
  const displayName = args[2];

  // Validate email
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(email)) {
    console.error(`Error: Invalid email format: ${email}`);
    process.exit(1);
  }

  // Validate password
  if (password.length < 8) {
    console.error('Error: Password must be at least 8 characters');
    process.exit(1);
  }

  try {
    await createAdminUser(email, password, displayName);
    process.exit(0);
  } catch (error) {
    process.exit(1);
  }
}

main();
