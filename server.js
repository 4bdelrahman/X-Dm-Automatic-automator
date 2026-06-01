import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';

// Import database (initializes on first import)
import db from './src/config/database.js';

// Import routes
import leadsRouter from './src/routes/leads.js';
import templatesRouter from './src/routes/templates.js';
import sequencesRouter from './src/routes/sequences.js';
import dashboardRouter from './src/routes/dashboard.js';
import automationRouter from './src/routes/automation.js';

// Import scheduler
import { initScheduler } from './src/services/scheduler.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 3000;

// ─── Middleware ────────────────────────────────────────────────────────
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ─── API Routes ───────────────────────────────────────────────────────
app.use('/api/leads', leadsRouter);
app.use('/api/templates', templatesRouter);
app.use('/api/sequences', sequencesRouter);
app.use('/api/dashboard', dashboardRouter);
app.use('/api/automation', automationRouter);

// ─── SPA Fallback ─────────────────────────────────────────────────────
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ─── Start Server ─────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log('');
  console.log('╔══════════════════════════════════════════════════╗');
  console.log('║    𝕏  Follow-Up Automation System               ║');
  console.log('╠══════════════════════════════════════════════════╣');
  console.log(`║  🌐 Dashboard:  http://localhost:${PORT}            ║`);
  console.log(`║  📡 API:        http://localhost:${PORT}/api         ║`);
  console.log(`║  ⚙️  Mode:       ${process.env.MODE || 'dry-run'}                      ║`);
  console.log(`║  📊 Max DMs:    ${process.env.MAX_DMS_PER_DAY || 30}/day                      ║`);
  console.log('╚══════════════════════════════════════════════════╝');
  console.log('');

  // Initialize the follow-up scheduler
  initScheduler();
});

// ─── Graceful Shutdown ────────────────────────────────────────────────
process.on('SIGINT', () => {
  console.log('\n🛑 Shutting down gracefully...');
  db.close();
  process.exit(0);
});

process.on('SIGTERM', () => {
  db.close();
  process.exit(0);
});
