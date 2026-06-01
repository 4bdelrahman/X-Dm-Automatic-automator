require('dotenv').config();
const express = require('express');
const cors = require('cors');
const authMiddleware = require('./middleware');
const { runCampaign, stopCampaign, getState } = require('./worker');

const app = express();
const PORT = process.env.PORT || 3001;

// ─── CORS ─────────────────────────────────────────────────────
// Allow requests from your Vercel frontend
app.use(cors({
  origin: [
    process.env.FRONTEND_URL,          // e.g. https://your-app.vercel.app
    'http://localhost:3000',            // local dev
    /\.vercel\.app$/,                   // all vercel preview deployments
  ].filter(Boolean),
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'X-API-Secret'],
}));

app.use(express.json());

// ─── HEALTH CHECK (no auth required) ─────────────────────────
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// ─── APPLY AUTH MIDDLEWARE TO ALL /api ROUTES ─────────────────
app.use('/api', authMiddleware);

// ─── START CAMPAIGN ───────────────────────────────────────────
app.post('/api/start-campaign', async (req, res) => {
  try {
    const state = getState();
    if (state.isRunning) {
      return res.status(409).json({
        success: false,
        error: 'Campaign is already running',
      });
    }

    const options = req.body || {};

    // Run campaign async — don't await, respond immediately
    runCampaign(options).catch((err) => {
      console.error('[API] Campaign error:', err.message);
    });

    res.json({
      success: true,
      message: 'Campaign started',
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// ─── STOP CAMPAIGN ────────────────────────────────────────────
app.post('/api/stop-campaign', (req, res) => {
  try {
    stopCampaign();
    res.json({ success: true, message: 'Stop signal sent' });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// ─── GET STATUS ───────────────────────────────────────────────
app.get('/api/status', (req, res) => {
  const state = getState();
  res.json({
    success: true,
    data: {
      isRunning: state.isRunning,
      totalLeads: state.totalLeads,
      sent: state.sent,
      failed: state.failed,
      skipped: state.skipped,
      currentLead: state.currentLead,
      startedAt: state.startedAt,
      progress: state.totalLeads > 0
        ? Math.round(((state.sent + state.failed) / state.totalLeads) * 100)
        : 0,
    },
  });
});

// ─── GET LOGS ─────────────────────────────────────────────────
app.get('/api/logs', (req, res) => {
  const state = getState();
  const limit = parseInt(req.query.limit || '50');
  res.json({
    success: true,
    data: state.logs.slice(0, limit),
  });
});

// ─── START SERVER ─────────────────────────────────────────────
app.listen(PORT, '0.0.0.0', () => {
  console.log(`[Server] X Cold DM Backend running on port ${PORT}`);
  console.log(`[Server] Environment: ${process.env.NODE_ENV || 'development'}`);
});
