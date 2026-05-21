function registerRoutes(app, auth, asyncHandler, zohoRoutes) {
  app.post('/api/email-response', auth.authenticateJWT, asyncHandler(async (req, res) => {
  const result = await zohoRoutes.handleEmailResponse(req.user, req.body);
  res.status(result.status).json(result.body);
}));
}

module.exports = {
  registerRoutes,
};
