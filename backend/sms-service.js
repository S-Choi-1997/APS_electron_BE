const SMS_MESSAGE_MAX_BYTES = 2000;

function makeHttpError(statusCode, errorCode, message, details = undefined) {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.errorCode = errorCode;
  if (details !== undefined) error.details = details;
  return error;
}

function normalizePhoneNumber(value) {
  const raw = String(value || '').trim();
  if (!raw) return null;

  let normalized = raw.replace(/[\s().-]/g, '');
  if (normalized.startsWith('+82')) {
    normalized = `0${normalized.slice(3)}`;
  } else if (/^82(10|2|[3-6]\d|70)/.test(normalized)) {
    normalized = `0${normalized.slice(2)}`;
  }

  if (!/^0\d{8,10}$/.test(normalized)) {
    return null;
  }

  return normalized;
}

function normalizeSmsReceivers(receiver) {
  const parts = String(receiver || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);

  if (parts.length === 0) {
    throw makeHttpError(400, 'invalid_receiver', '수신자 번호가 필요합니다.');
  }

  if (parts.length > 1000) {
    throw makeHttpError(400, 'too_many_receivers', 'SMS 수신자는 최대 1000명까지 보낼 수 있습니다.');
  }

  const normalized = [];
  const invalid = [];

  parts.forEach((part) => {
    const phone = normalizePhoneNumber(part);
    if (phone) normalized.push(phone);
    else invalid.push(part);
  });

  if (invalid.length > 0) {
    throw makeHttpError(400, 'invalid_receiver', '전화번호 형식이 올바르지 않습니다.', { invalid });
  }

  return {
    receiver: normalized.join(','),
    count: normalized.length,
  };
}

function normalizeSmsMessage(message) {
  const normalized = String(message || '').trim();
  if (!normalized) {
    throw makeHttpError(400, 'invalid_message', 'SMS 메시지가 필요합니다.');
  }

  if (Buffer.byteLength(normalized, 'utf8') > SMS_MESSAGE_MAX_BYTES) {
    throw makeHttpError(400, 'message_too_long', `SMS 메시지는 ${SMS_MESSAGE_MAX_BYTES}바이트를 넘을 수 없습니다.`);
  }

  return normalized;
}

function parseAligoCount(value) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : 0;
}

async function sendSmsViaRelay({ receiver, msg, msg_type, title, testmode_yn }, userEmail) {
  const smsRelayUrl = process.env.SMS_RELAY_URL || '';
  const smsRelayAuthToken = process.env.SMS_RELAY_AUTH_TOKEN || '';

  if (!smsRelayUrl) {
    throw makeHttpError(500, 'server_config_error', 'SMS_RELAY_URL is not configured');
  }

  const ALIGO_API_KEY = process.env.ALIGO_API_KEY;
  const ALIGO_USER_ID = process.env.ALIGO_USER_ID;
  const ALIGO_SENDER = process.env.ALIGO_SENDER_PHONE;

  if (!ALIGO_API_KEY || !ALIGO_USER_ID || !ALIGO_SENDER) {
    console.error('Aligo SMS credentials not configured');
    throw makeHttpError(500, 'server_config_error', 'SMS service not configured');
  }

  const normalizedReceivers = normalizeSmsReceivers(receiver);
  const normalizedMessage = normalizeSmsMessage(msg);
  const normalizedMsgType = msg_type ? String(msg_type).trim().toUpperCase() : undefined;
  const normalizedTestMode = testmode_yn ? String(testmode_yn).trim().toUpperCase() : undefined;

  if (normalizedMsgType && !['SMS', 'LMS', 'MMS'].includes(normalizedMsgType)) {
    throw makeHttpError(400, 'invalid_msg_type', 'msg_type must be SMS, LMS, or MMS');
  }

  if (normalizedTestMode && !['Y', 'N'].includes(normalizedTestMode)) {
    throw makeHttpError(400, 'invalid_testmode', 'testmode_yn must be Y or N');
  }

  const relayPayload = {
    key: ALIGO_API_KEY,
    user_id: ALIGO_USER_ID,
    sender: ALIGO_SENDER,
    receiver: normalizedReceivers.receiver,
    msg: normalizedMessage,
  };

  if (normalizedMsgType) relayPayload.msg_type = normalizedMsgType;
  if (title) relayPayload.title = String(title).trim();
  if (normalizedTestMode) relayPayload.testmode_yn = normalizedTestMode;

  const headers = {
    'Content-Type': 'application/json',
  };

  if (smsRelayAuthToken) {
    headers.Authorization = `Bearer ${smsRelayAuthToken}`;
  }

  console.log(`[SMS] Sending via fixed-IP relay: ${smsRelayUrl}/sms/send`);

  const aligoResponse = await fetch(`${smsRelayUrl}/sms/send`, {
    method: 'POST',
    headers,
    body: JSON.stringify(relayPayload),
  });

  let aligoResult = null;
  try {
    aligoResult = await aligoResponse.json();
  } catch (parseError) {
    const errorText = await aligoResponse.text().catch(() => '');
    console.error('Aligo relay returned non-JSON response:', errorText);
    throw makeHttpError(502, 'sms_provider_error', 'SMS relay returned an invalid response');
  }

  if (!aligoResponse.ok) {
    console.error('Aligo relay request failed:', aligoResult);
    throw makeHttpError(502, 'sms_provider_error', aligoResult?.message || 'Failed to send SMS', {
      provider: aligoResult,
    });
  }

  const resultCode = Number.parseInt(aligoResult.result_code, 10);
  const successCount = parseAligoCount(aligoResult.success_cnt);
  const errorCount = parseAligoCount(aligoResult.error_cnt);

  if (!Number.isFinite(resultCode) || resultCode < 0 || successCount <= 0) {
    console.error('Aligo API error:', aligoResult);
    throw makeHttpError(502, 'sms_failed', aligoResult.message || 'SMS send failed', {
      provider: aligoResult,
    });
  }

  if (errorCount > 0 || successCount < normalizedReceivers.count) {
    console.error('Aligo API partial failure:', aligoResult);
    throw makeHttpError(502, 'sms_partial_failed', aligoResult.message || 'Some SMS recipients failed', {
      provider: aligoResult,
      requested_cnt: normalizedReceivers.count,
    });
  }

  console.log(`[SMS] Sent by ${userEmail}: ${successCount} success, ${errorCount} failed`);

  return {
    msg_id: aligoResult.msg_id,
    success_cnt: successCount,
    error_cnt: errorCount,
    msg_type: aligoResult.msg_type,
    receiver: normalizedReceivers.receiver,
    result_code: resultCode,
  };
}

module.exports = {
  sendSmsViaRelay,
};
