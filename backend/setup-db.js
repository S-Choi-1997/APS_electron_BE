/**
 * Database Setup Script
 *
 * Runs all migrations in order to set up the database schema
 * Run this once before starting the server for the first time
 */

const { query } = require('./db');
const fs = require('fs');
const path = require('path');

const MIGRATIONS_DIR = path.join(__dirname, 'migrations');

const migrations = [
  '000_create_email_inquiries_table.sql',
  '001_add_source_column.sql',
  '002_create_zoho_tokens_table.sql',
  '003_add_thread_and_status_fields.sql',
  '004_add_email_translation_fields.sql',
  '005_email_mail_client_backend.sql',
  '006_email_delivery_status.sql'
];

async function runMigrations() {
  console.log('🚀 Starting database setup...\n');

  for (const migration of migrations) {
    const filePath = path.join(MIGRATIONS_DIR, migration);

    try {
      console.log(`📄 Running: ${migration}`);
      const sql = fs.readFileSync(filePath, 'utf8');
      await query(sql);
      console.log(`✅ Success: ${migration}\n`);
    } catch (error) {
      // If table already exists, that's okay
      if (error.message && error.message.includes('already exists')) {
        console.log(`⚠️  Already exists: ${migration} (skipping)\n`);
      } else {
        console.error(`❌ Error running ${migration}:`, error.message);
        throw error;
      }
    }
  }

  console.log('✅ Database setup completed!\n');
  console.log('You can now start the server with: npm start');
}

// Run migrations
runMigrations()
  .then(() => {
    process.exit(0);
  })
  .catch((error) => {
    console.error('\n❌ Database setup failed:', error);
    process.exit(1);
  });
