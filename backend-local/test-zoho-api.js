/**
 * ZOHO API 테스트 스크립트
 *
 * 이메일 전체 내용 및 첨부파일 가져오기 테스트
 */

require('dotenv').config();
const { query } = require('./db');
const { fetchMessageContent, fetchAttachmentInfo, downloadAttachment } = require('./zoho/mail-api');

async function testZohoAPI() {
  console.log('=== ZOHO API 테스트 시작 ===\n');

  try {
    // 1. DB 연결 및 이메일 목록 확인
    console.log('1. DB 연결 확인...');
    const countResult = await query('SELECT COUNT(*) FROM email_inquiries WHERE source = $1', ['zoho']);
    console.log(`   ZOHO 이메일 수: ${countResult.rows[0].count}\n`);

    // 2. folder_id가 있는 이메일 확인
    console.log('2. folder_id가 있는 이메일 확인...');
    const withFolderIdResult = await query(
      'SELECT COUNT(*) FROM email_inquiries WHERE source = $1 AND folder_id IS NOT NULL',
      ['zoho']
    );
    console.log(`   folder_id가 있는 이메일: ${withFolderIdResult.rows[0].count}\n`);

    // 3. 샘플 이메일 조회 (folder_id가 있고 첨부파일이 있는 것 우선)
    console.log('3. 테스트용 이메일 조회...');
    const sampleResult = await query(`
      SELECT id, message_id, folder_id, subject, has_attachments, source
      FROM email_inquiries
      WHERE source = 'zoho'
      ORDER BY
        CASE WHEN folder_id IS NOT NULL AND has_attachments = true THEN 0
             WHEN folder_id IS NOT NULL THEN 1
             ELSE 2 END,
        received_at DESC
      LIMIT 5
    `);

    if (sampleResult.rows.length === 0) {
      console.log('   ZOHO 이메일이 없습니다.\n');
      process.exit(0);
    }

    console.log('   샘플 이메일 목록:');
    sampleResult.rows.forEach((row, i) => {
      console.log(`   [${i + 1}] ID: ${row.id}`);
      console.log(`       folder_id: ${row.folder_id || 'NULL'}`);
      console.log(`       has_attachments: ${row.has_attachments}`);
      console.log(`       subject: ${row.subject?.substring(0, 50)}...`);
      console.log('');
    });

    // 4. folder_id가 있는 이메일로 API 테스트
    const testEmail = sampleResult.rows.find(r => r.folder_id);

    if (!testEmail) {
      console.log('4. folder_id가 있는 이메일이 없어서 API 테스트 불가\n');
      console.log('   => 이메일을 다시 Sync해야 folder_id가 저장됩니다.\n');
      process.exit(0);
    }

    console.log(`4. API 테스트 (이메일 ID: ${testEmail.id})...`);
    console.log(`   message_id: ${testEmail.message_id}`);
    console.log(`   folder_id: ${testEmail.folder_id}\n`);

    // 5. 전체 내용 가져오기 테스트
    console.log('5. fetchMessageContent() 테스트...');
    try {
      const content = await fetchMessageContent(testEmail.message_id, testEmail.folder_id);
      console.log(`   성공! 내용 길이: ${content?.length || 0} 글자`);
      console.log(`\n=== 전체 본문 내용 ===\n`);
      console.log(content);
      console.log(`\n=== 본문 끝 ===\n`);
    } catch (error) {
      console.log(`   실패: ${error.message}\n`);
    }

    // 6. 첨부파일 정보 가져오기 테스트
    console.log('6. fetchAttachmentInfo() 테스트...');
    try {
      const attachments = await fetchAttachmentInfo(testEmail.message_id, testEmail.folder_id);
      console.log(`   성공! 첨부파일 수: ${attachments.length}`);
      attachments.forEach((att, i) => {
        console.log(`   [${i + 1}] ${att.attachmentName} (${att.attachmentSize} bytes)`);
      });
      console.log('');
    } catch (error) {
      console.log(`   실패: ${error.message}\n`);
    }

    // 7. 첨부파일이 있는 이메일 별도 테스트
    const emailWithAttachment = sampleResult.rows.find(r => r.folder_id && r.has_attachments);
    if (emailWithAttachment && emailWithAttachment.id !== testEmail.id) {
      console.log(`7. 첨부파일 있는 이메일 별도 테스트 (ID: ${emailWithAttachment.id})...`);
      try {
        const attachments = await fetchAttachmentInfo(
          emailWithAttachment.message_id,
          emailWithAttachment.folder_id
        );
        console.log(`   첨부파일 수: ${attachments.length}`);
        attachments.forEach((att, i) => {
          console.log(`   [${i + 1}] ${att.attachmentName} (${att.attachmentSize} bytes)`);
        });
      } catch (error) {
        console.log(`   실패: ${error.message}`);
      }
    }

    console.log('\n=== 테스트 완료 ===');
    process.exit(0);

  } catch (error) {
    console.error('\n!!! 오류 발생 !!!');
    console.error(error);
    process.exit(1);
  }
}

testZohoAPI();
