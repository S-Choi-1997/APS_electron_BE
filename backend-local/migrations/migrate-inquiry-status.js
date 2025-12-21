/**
 * Firestore Migration: Add 'status' field to inquiries collection
 *
 * 기존 inquiries 문서에 status 필드를 추가합니다.
 * - check === false → status: 'unread'
 * - check === true → status: 'responded' (SMS 발송되었으므로)
 *
 * 실행: node backend-local/migrations/migrate-inquiry-status.js
 */

const { Firestore, FieldValue } = require('@google-cloud/firestore');

// GCP Firestore 초기화 (gcloud 인증 사용)
const db = new Firestore({
  projectId: process.env.GCP_PROJECT_ID || 'apsconsulting'
});

console.log('✓ Firestore initialized successfully');

async function migrateInquiryStatus() {
  try {
    console.log('Starting migration: Adding status field to inquiries...');

    const snapshot = await db.collection('inquiries').get();

    if (snapshot.empty) {
      console.log('No inquiries found. Nothing to migrate.');
      return;
    }

    console.log(`Found ${snapshot.size} inquiries to migrate.`);

    let updated = 0;
    let skipped = 0;
    let errors = 0;

    const batch = db.batch();
    const batchSize = 500; // Firestore batch limit
    let currentBatch = 0;

    for (const doc of snapshot.docs) {
      const data = doc.data();

      // 기존 status가 'new'인 경우 또는 없는 경우 업데이트
      if (data.status && data.status !== 'new') {
        console.log(`[SKIP] ${doc.id} - status already migrated: ${data.status}`);
        skipped++;
        continue;
      }

      // check 필드에 따라 status 설정
      const status = data.check === true ? 'responded' : 'unread';

      batch.update(doc.ref, {
        status: status,
        updatedAt: FieldValue.serverTimestamp()
      });

      updated++;
      currentBatch++;

      console.log(`[UPDATE] ${doc.id} - old status: ${data.status || 'none'}, check: ${data.check} → new status: ${status}`);

      // Batch 크기 제한에 도달하면 커밋
      if (currentBatch >= batchSize) {
        await batch.commit();
        console.log(`Committed batch of ${currentBatch} updates.`);
        currentBatch = 0;
      }
    }

    // 남은 batch 커밋
    if (currentBatch > 0) {
      await batch.commit();
      console.log(`Committed final batch of ${currentBatch} updates.`);
    }

    console.log('\n========================================');
    console.log('Migration completed!');
    console.log(`  Updated: ${updated}`);
    console.log(`  Skipped: ${skipped}`);
    console.log(`  Errors:  ${errors}`);
    console.log('========================================\n');

  } catch (error) {
    console.error('Migration failed:', error);
    process.exit(1);
  }
}

// 실행
migrateInquiryStatus()
  .then(() => {
    console.log('Migration script finished successfully.');
    process.exit(0);
  })
  .catch((error) => {
    console.error('Migration script failed:', error);
    process.exit(1);
  });
