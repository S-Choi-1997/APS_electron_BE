/**
 * SMS Relay 서버 (GCP3/sms-relay/)
 *
 * 알리고 SMS API의 고정 IP 화이트리스트 요구사항을 충족하기 위한 Relay 서버
 *
 * 서버 정보:
 * - VM: aligo-proxy (GCP Compute Engine, us-central1-a)
 * - 고정 IP: 136.113.67.193
 * - 포트: 3000
 * - 비용: 프리티어 ($0/월)
 *
 * 기능:
 * - GCP2 백엔드로부터 SMS 발송 요청을 받아 Aligo API로 전달
 * - 고정 IP를 통해 Aligo API에 접근 (IP 화이트리스트 통과)
 *
 * 엔드포인트:
 * - GET /health - 헬스 체크
 * - POST /sms/send - SMS 발송 (Aligo API로 릴레이)
 *
 * 배포:
 * - VM에 직접 배포 (install.sh 사용)
 * - systemd 서비스로 실행 (sms-relay.service)
 *
 * 사용처: GCP2 백엔드 (index.js의 SMS 발송 기능)
 */

const express = require('express');
const fetch = require('node-fetch');

const app = express();
const PORT = 3000;

// Parse JSON and URL-encoded bodies
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ status: 'ok', service: 'aligo-sms-relay' });
});

// SMS relay endpoint
app.post('/sms/send', async (req, res) => {
  try {
    const { key, user_id, sender, receiver, msg, msg_type, title, testmode_yn } = req.body;

    // Validate required fields
    if (!key || !user_id || !sender || !receiver || !msg) {
      return res.status(400).json({
        error: 'bad_request',
        message: 'Missing required fields: key, user_id, sender, receiver, msg'
      });
    }

    // Prepare form data for Aligo API
    const formData = new URLSearchParams({
      key,
      user_id,
      sender,
      receiver,
      msg,
    });

    // Add optional parameters
    if (msg_type) formData.append('msg_type', msg_type);
    if (title) formData.append('title', title);
    if (testmode_yn) formData.append('testmode_yn', testmode_yn);

    console.log(`[${new Date().toISOString()}] Sending SMS to ${receiver}`);

    // Forward request to Aligo API
    const aligoResponse = await fetch('https://apis.aligo.in/send/', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: formData,
    });

    const aligoResult = await aligoResponse.json();

    console.log(`[${new Date().toISOString()}] Aligo response:`, aligoResult);

    // Return Aligo's response
    res.json(aligoResult);

  } catch (error) {
    console.error(`[${new Date().toISOString()}] Error:`, error);
    res.status(500).json({
      error: 'relay_error',
      message: error.message
    });
  }
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`SMS Relay Server running on port ${PORT}`);
  console.log(`Health check: http://localhost:${PORT}/health`);
  console.log(`SMS endpoint: http://localhost:${PORT}/sms/send`);
});
