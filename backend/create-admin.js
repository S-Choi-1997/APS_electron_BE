/**
 * Create Admin User Script (Firestore)
 *
 * Firestore admins 컬렉션에 관리자 계정을 생성하는 스크립트입니다.
 * PostgreSQL users 테이블 대신 Firestore를 사용합니다.
 *
 * 사용법:
 *   node create-admin.js <email> <password> [displayName] [role]
 *
 * 예시:
 *   node create-admin.js admin@example.com MyPassword123 "관리자" admin
 *   node create-admin.js user@example.com UserPass123 "사용자" user
 *
 * 참고:
 *   - role 기본값: admin
 *   - displayName 기본값: email 주소
 */

const path = require('path');

// Load environment variables
require('dotenv').config({ path: path.join(__dirname, '.env') });

// Initialize Firebase Admin SDK
const admin = require('firebase-admin');

try {
  admin.initializeApp({
    credential: admin.credential.applicationDefault(),
  });
  console.log('✓ Firebase Admin initialized\n');
} catch (error) {
  console.error('❌ Failed to initialize Firebase Admin:', error.message);
  console.error('Make sure GOOGLE_APPLICATION_CREDENTIALS environment variable is set');
  process.exit(1);
}

// Import Firestore admin module
const firestoreAdmin = require('./firestore-admin');

async function createAdminUser(email, password, displayName, role) {
  try {
    console.log(`[Create Admin] Creating ${role} user: ${email}`);

    // Check if admin already exists
    const existing = await firestoreAdmin.getAdminByEmail(email);

    if (existing) {
      console.error(`❌ Error: User ${email} already exists in Firestore`);
      console.log('\nExisting user details:');
      console.log(`  Email:        ${existing.email}`);
      console.log(`  Display Name: ${existing.display_name}`);
      console.log(`  Role:         ${existing.role}`);
      console.log(`  Active:       ${existing.active}`);
      process.exit(1);
    }

    // Create admin in Firestore
    console.log('[Create Admin] Creating Firestore document...');
    const newAdmin = await firestoreAdmin.createAdmin(
      email,
      password,
      displayName || email,
      role
    );

    console.log('\n✅ Admin user created successfully in Firestore!');
    console.log('---------------------------------------------------');
    console.log(`Email:        ${newAdmin.email}`);
    console.log(`Display Name: ${newAdmin.display_name}`);
    console.log(`Role:         ${newAdmin.role}`);
    console.log(`Active:       ${newAdmin.active}`);
    console.log(`Provider:     ${newAdmin.provider}`);
    console.log('---------------------------------------------------');
    console.log('\nYou can now login with these credentials.\n');

    return newAdmin;
  } catch (error) {
    console.error('❌ Failed to create admin user:', error.message);
    throw error;
  }
}

async function main() {
  const args = process.argv.slice(2);

  if (args.length < 2) {
    console.error('Error: Email and password are required\n');
    console.log('Usage:');
    console.log('  node create-admin.js <email> <password> [displayName] [role]\n');
    console.log('Examples:');
    console.log('  node create-admin.js admin@example.com MyPassword123 "관리자" admin');
    console.log('  node create-admin.js user@example.com UserPass123 "사용자" user');
    console.log('  node create-admin.js test@example.com TestPass123\n');
    console.log('Parameters:');
    console.log('  email       - User email address (required)');
    console.log('  password    - User password, min 8 characters (required)');
    console.log('  displayName - Display name (optional, default: email)');
    console.log('  role        - User role: admin or user (optional, default: admin)\n');
    process.exit(1);
  }

  const email = args[0];
  const password = args[1];
  const displayName = args[2];
  const role = args[3] || 'admin';

  // Validate email
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(email)) {
    console.error(`❌ Error: Invalid email format: ${email}`);
    process.exit(1);
  }

  // Validate password
  if (password.length < 8) {
    console.error('❌ Error: Password must be at least 8 characters');
    process.exit(1);
  }

  // Validate role
  if (!['admin', 'user'].includes(role)) {
    console.error(`❌ Error: Invalid role: ${role}. Must be "admin" or "user"`);
    process.exit(1);
  }

  try {
    await createAdminUser(email, password, displayName, role);
    process.exit(0);
  } catch (error) {
    process.exit(1);
  }
}

main();
