/**
 * 기존 이메일의 folder_id 업데이트 스크립트
 *
 * ZOHO API에서 folder 정보를 가져와 기존 이메일에 folder_id를 설정합니다.
 */

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

// Firebase Admin 초기화
const admin = require('firebase-admin');
if (!admin.apps.length) {
  const serviceAccount = require(process.env.GOOGLE_APPLICATION_CREDENTIALS);
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount)
  });
}

const { query } = require('../db');
const { fetchFolders, getAccountId } = require('../zoho/mail-api');
const { getValidAccessToken } = require('../zoho/oauth');
const axios = require('axios');

const config = {
  apiBaseUrl: 'https://mail.zoho.com/api'
};

async function updateFolderIds() {
  console.log('=== folder_id 업데이트 시작 ===\n');

  try {
    // 1. folder_id가 NULL인 이메일 조회
    const nullFolderResult = await query(`
      SELECT id, message_id, subject, is_outgoing
      FROM email_inquiries
      WHERE source = 'zoho' AND folder_id IS NULL
      ORDER BY received_at DESC
    `);

    console.log(`folder_id가 NULL인 이메일: ${nullFolderResult.rows.length}개\n`);

    if (nullFolderResult.rows.length === 0) {
      console.log('업데이트할 이메일이 없습니다.');
      process.exit(0);
    }

    // 2. ZOHO에서 폴더 목록 가져오기
    console.log('ZOHO 폴더 목록 조회 중...');
    const accessToken = await getValidAccessToken();
    const accountId = await getAccountId();

    const foldersResponse = await axios.get(`${config.apiBaseUrl}/accounts/${accountId}/folders`, {
      headers: { 'Authorization': `Bearer ${accessToken}` }
    });

    const folders = foldersResponse.data.data;
    const inboxFolder = folders.find(f => f.folderName === 'Inbox');
    const sentFolder = folders.find(f => f.folderName === 'Sent');

    console.log(`Inbox folderId: ${inboxFolder?.folderId}`);
    console.log(`Sent folderId: ${sentFolder?.folderId}\n`);

    if (!inboxFolder || !sentFolder) {
      throw new Error('Inbox 또는 Sent 폴더를 찾을 수 없습니다');
    }

    // 3. 각 이메일에 folder_id 업데이트
    let updatedCount = 0;
    let errorCount = 0;

    for (const email of nullFolderResult.rows) {
      try {
        // 보낸 메일이면 Sent, 아니면 Inbox
        const folderId = email.is_outgoing ? sentFolder.folderId : inboxFolder.folderId;

        await query(
          'UPDATE email_inquiries SET folder_id = $1, updated_at = NOW() WHERE id = $2',
          [folderId, email.id]
        );

        updatedCount++;
        console.log(`[${updatedCount}] ID: ${email.id} → folder_id: ${folderId} (${email.is_outgoing ? 'Sent' : 'Inbox'})`);
      } catch (error) {
        errorCount++;
        console.error(`[ERROR] ID: ${email.id} - ${error.message}`);
      }
    }

    console.log(`\n=== 업데이트 완료 ===`);
    console.log(`성공: ${updatedCount}개`);
    console.log(`실패: ${errorCount}개`);

    process.exit(0);
  } catch (error) {
    console.error('\n!!! 오류 발생 !!!');
    console.error(error);
    process.exit(1);
  }
}

updateFolderIds();
