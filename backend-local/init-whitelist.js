/**
 * Firestore Whitelist Initialization Script
 *
 * 초기 화이트리스트 데이터를 Firestore에 생성합니다.
 *
 * 사용법:
 *   node init-whitelist.js <your-email> [role]
 *
 * 예시:
 *   node init-whitelist.js admin@example.com admin
 *   node init-whitelist.js user@example.com user
 */

const admin = require('firebase-admin');
const path = require('path');

// Firestore Admin SDK 초기화
const serviceAccount = require(path.join(__dirname, 'service-account.json'));

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

const db = admin.firestore();

async function addToWhitelist(email, role = 'user') {
  try {
    console.log(`[Whitelist] Adding ${email} with role: ${role}...`);

    const whitelistRef = db.collection('whitelist').doc(email);

    await whitelistRef.set({
      email,
      role,
      active: true,
      created_at: admin.firestore.FieldValue.serverTimestamp(),
      created_by: 'system', // 초기 설정은 시스템이 생성
    });

    console.log(`✅ [Whitelist] Successfully added ${email}`);
  } catch (error) {
    console.error(`❌ [Whitelist] Failed to add ${email}:`, error.message);
    process.exit(1);
  }
}

async function listWhitelist() {
  try {
    console.log('\n[Whitelist] Current whitelist:');
    const snapshot = await db.collection('whitelist').where('active', '==', true).get();

    if (snapshot.empty) {
      console.log('  (empty)');
      return;
    }

    snapshot.forEach((doc) => {
      const data = doc.data();
      console.log(`  - ${data.email} (${data.role})`);
    });
  } catch (error) {
    console.error('❌ [Whitelist] Failed to list whitelist:', error.message);
  }
}

async function main() {
  const args = process.argv.slice(2);

  if (args.length === 0) {
    console.error('Error: Email address required');
    console.log('\nUsage:');
    console.log('  node init-whitelist.js <email> [role]');
    console.log('\nExample:');
    console.log('  node init-whitelist.js admin@example.com admin');
    console.log('  node init-whitelist.js user@example.com user');
    process.exit(1);
  }

  const email = args[0];
  const role = args[1] || 'user';

  // 유효한 이메일 형식인지 확인
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(email)) {
    console.error(`Error: Invalid email format: ${email}`);
    process.exit(1);
  }

  // 유효한 role인지 확인
  if (!['admin', 'user'].includes(role)) {
    console.error(`Error: Invalid role: ${role}. Must be 'admin' or 'user'`);
    process.exit(1);
  }

  await addToWhitelist(email, role);
  await listWhitelist();

  console.log('\n✅ Whitelist initialization complete!');
  process.exit(0);
}

main();
