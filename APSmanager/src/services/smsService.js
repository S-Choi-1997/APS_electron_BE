import { apiRequest, API_ENDPOINTS } from '../config/api';

/**
 * Send SMS via Aligo API
 * @param {object} params - SMS parameters
 * @param {string} params.receiver - Phone number(s), comma-separated for multiple
 * @param {string} params.msg - Message content (1-2000 bytes)
 * @param {string} [params.msg_type] - SMS, LMS, or MMS (optional)
 * @param {string} [params.title] - Message title for LMS/MMS (optional)
 * @param {string} [params.testmode_yn] - 'Y' for test mode (optional)
 * @param {object} auth - Auth object from authManager
 * @returns {Promise<object>}
 */
export async function sendSMS(params, auth) {
  const { receiver, msg, msg_type, title, testmode_yn } = params;

  if (!receiver || !msg) {
    throw new Error('수신자 번호와 메시지는 필수입니다.');
  }

  const response = await apiRequest(
    API_ENDPOINTS.SMS_SEND,
    {
      method: 'POST',
      body: JSON.stringify({
        receiver,
        msg,
        msg_type,
        title,
        testmode_yn,
      }),
    },
    auth
  );

  return response.data;
}

/**
 * Send SMS to multiple recipients
 * @param {string[]} phoneNumbers - Array of phone numbers
 * @param {string} message - Message content
 * @param {object} auth - Auth object
 * @returns {Promise<object>}
 */
export async function sendBulkSMS(phoneNumbers, message, auth) {
  if (!Array.isArray(phoneNumbers) || phoneNumbers.length === 0) {
    throw new Error('수신자가 없습니다.');
  }

  // Join phone numbers with comma (Aligo API supports up to 1000 recipients)
  const receiver = phoneNumbers.join(',');

  return sendSMS({ receiver, msg: message }, auth);
}

/**
 * Send test SMS (won't actually send, useful for testing)
 * @param {string} receiver - Phone number
 * @param {string} msg - Message content
 * @param {object} auth - Auth object
 * @returns {Promise<object>}
 */
export async function sendTestSMS(receiver, msg, auth) {
  return sendSMS({ receiver, msg, testmode_yn: 'Y' }, auth);
}
