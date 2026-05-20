const { sendSmsViaRelay } = require('./sms-service');

function sendApiError(res, error, fallbackStatus = 500) {
  const statusCode = error.statusCode || fallbackStatus;
  res.status(statusCode).json({
    error: error.errorCode || (statusCode >= 500 ? 'internal_error' : 'bad_request'),
    message: error.message,
    ...(error.details !== undefined ? { details: error.details } : {}),
  });
}

function registerRoutes(app, auth) {
  app.post('/sms/send', auth.authenticateJWT, async (req, res) => {
    try {
      const { receiver, msg, msg_type, title, testmode_yn } = req.body;
      const smsResult = await sendSmsViaRelay({
        receiver,
        msg,
        msg_type,
        title,
        testmode_yn,
      }, req.user.email);

      res.json({
        status: 'ok',
        data: smsResult,
      });
    } catch (error) {
      console.error('SMS send error:', error);
      sendApiError(res, error);
    }
  });
}

module.exports = {
  registerRoutes,
};
