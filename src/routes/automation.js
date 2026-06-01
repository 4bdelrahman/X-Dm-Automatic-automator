import { Router } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { launchBrowser, loginToX, sendDM, closeBrowser, getBrowserStatus, scrapeDMContacts } from '../services/twitter.js';
import { getSchedulerStatus, pauseScheduler, resumeScheduler, triggerProcessing } from '../services/scheduler.js';
import { getStatus as getRateLimitStatus } from '../services/rateLimiter.js';
import { buildMessage } from '../services/messageBuilder.js';
import db from '../config/database.js';

const router = Router();

// GET /api/automation/status
router.get('/status', (req, res) => {
  res.json({
    browser: getBrowserStatus(),
    scheduler: getSchedulerStatus(),
    rateLimiter: getRateLimitStatus(),
    mode: process.env.MODE || 'dry-run'
  });
});

// POST /api/automation/launch-browser
router.post('/launch-browser', async (req, res) => {
  try {
    const result = await launchBrowser();
    res.json(result);
  } catch (error) { res.status(500).json({ error: error.message }); }
});

// POST /api/automation/login
router.post('/login', async (req, res) => {
  try {
    const result = await loginToX();
    res.json(result);
  } catch (error) { res.status(500).json({ error: error.message }); }
});

// POST /api/automation/close-browser
router.post('/close-browser', async (req, res) => {
  try {
    const result = await closeBrowser();
    res.json(result);
  } catch (error) { res.status(500).json({ error: error.message }); }
});

// POST /api/automation/send-dm — Send a single DM manually
router.post('/send-dm', async (req, res) => {
  try {
    const { handle, message, templateId, variables } = req.body;
    if (!handle) return res.status(400).json({ error: 'handle is required' });

    let msgText = message;
    if (templateId && !message) {
      const tmpl = db.prepare('SELECT * FROM templates WHERE id = ?').get(templateId);
      if (!tmpl) return res.status(404).json({ error: 'Template not found' });
      msgText = buildMessage(tmpl.content, variables || {});
    }
    if (!msgText) return res.status(400).json({ error: 'message or templateId required' });

    const isDryRun = (process.env.MODE || 'dry-run') === 'dry-run';
    const result = await sendDM(handle, msgText, isDryRun);
    res.json(result);
  } catch (error) { res.status(500).json({ error: error.message }); }
});

// POST /api/automation/pause
router.post('/pause', (req, res) => {
  pauseScheduler();
  res.json({ success: true, status: 'paused' });
});

// POST /api/automation/resume
router.post('/resume', (req, res) => {
  resumeScheduler();
  res.json({ success: true, status: 'running' });
});

// POST /api/automation/trigger — Manually trigger follow-up processing
router.post('/trigger', async (req, res) => {
  try {
    const result = await triggerProcessing();
    res.json(result);
  } catch (error) { res.status(500).json({ error: error.message }); }
});

// POST /api/automation/scrape-dms — Scrape all DM contacts and import as leads
router.post('/scrape-dms', async (req, res) => {
  try {
    const { maxScroll } = req.body;
    const result = await scrapeDMContacts(maxScroll || 15);

    if (!result.success) {
      return res.json(result);
    }

    // Import scraped contacts as leads
    const insert = db.prepare(
      'INSERT OR IGNORE INTO leads (id, x_handle, display_name, notes, tags) VALUES (?, ?, ?, ?, ?)'
    );

    let created = 0;
    let skipped = 0;

    for (const contact of result.contacts) {
      const r = insert.run(
        uuidv4(),
        contact.handle,
        contact.displayName || '',
        'Imported from DM conversations',
        JSON.stringify(['dm-import'])
      );
      if (r.changes > 0) created++;
      else skipped++;
    }

    // Update daily stats
    if (created > 0) {
      const today = new Date().toISOString().split('T')[0];
      db.prepare(
        'INSERT INTO daily_stats (date, new_leads) VALUES (?, ?) ON CONFLICT(date) DO UPDATE SET new_leads = new_leads + ?'
      ).run(today, created, created);
    }

    res.json({
      success: true,
      totalScraped: result.contacts.length,
      created,
      skipped,
      contacts: result.contacts
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

export default router;
