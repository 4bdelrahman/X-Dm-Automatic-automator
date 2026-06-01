// Middleware to protect all API endpoints with a secret key
const authMiddleware = (req, res, next) => {
  // Allow health check without auth
  if (req.path === '/health') return next();

  const apiSecret = req.headers['x-api-secret'];

  if (!apiSecret || apiSecret !== process.env.API_SECRET) {
    return res.status(401).json({
      success: false,
      error: 'Unauthorized. Missing or invalid X-API-Secret header.'
    });
  }

  next();
};

module.exports = authMiddleware;
