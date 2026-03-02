/**
 * ZOHO API 원시 응답 테스트
 */

require('dotenv').config();
const { fetchMessages } = require('./zoho/mail-api');

async function testRawResponse() {
  console.log('=== ZOHO API 원시 응답 테스트 ===\n');

  try {
    // Inbox에서 최근 메시지 1개 가져오기
    const messages = await fetchMessages({ folder: 'Inbox', limit: 2 });

    console.log('메시지 수:', messages.length);
    console.log('\n첫 번째 메시지 전체 필드:');
    console.log(JSON.stringify(messages[0], null, 2));

    console.log('\n=== 주요 필드 확인 ===');
    console.log('messageId:', messages[0]?.messageId);
    console.log('folderId:', messages[0]?.folderId);
    console.log('hasAttachment:', messages[0]?.hasAttachment);
    console.log('subject:', messages[0]?.subject);

    process.exit(0);
  } catch (error) {
    console.error('Error:', error.message);
    process.exit(1);
  }
}

testRawResponse();
