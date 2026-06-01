import { Router } from 'express';
import db from '../config/database.js';
import { getStatus as getRateLimitStatus } from '../services/rateLimiter.js';
import { getSchedulerStatus } from '../services/scheduler.js';

const router = Router();

router.get('/overview', (req, res) => {
  try {
    const totalLeads = db.prepare('SELECT COUNT(*) as count FROM leads').get().count;
    const statusBreakdown = db.prepare('SELECT status, COUNT(*) as count FROM leads GROUP BY status').all();
    const totalMessagesSent = db.prepare("SELECT COUNT(*) as count FROM messages WHERE status IN ('sent','dry_run')").get().count;
    const totalFailed = db.prepare("SELECT COUNT(*) as count FROM messages WHERE status = 'failed'").get().count;
    const replied = db.prepare("SELECT COUNT(*) as count FROM leads WHERE status = 'replied'").get().count;
    const converted = db.prepare("SELECT COUNT(*) as count FROM leads WHERE status = 'converted'").get().count;
    const pendingFollowups = db.prepare("SELECT COUNT(*) as count FROM leads WHERE next_followup_at IS NOT NULL AND status NOT IN ('replied','converted','paused','blocked','no_response')").get().count;
    const conversionRate = totalLeads > 0 ? ((replied + converted) / totalLeads * 100).toFixed(1) : 0;

    res.json({ totalLeads, statusBreakdown, totalMessagesSent, totalFailed, replied, converted, pendingFollowups, conversionRate, rateLimiter: getRateLimitStatus(), scheduler: getSchedulerStatus() });
  } catch (error) { res.status(500).json({ error: error.message }); }
});

router.get('/recent-activity', (req, res) => {
  try {
    const limit = parseInt(req.query.limit || '20');
    const msgs = db.prepare(`SELECT m.*, l.x_handle, l.display_name, t.name as template_name FROM messages m JOIN leads l ON m.lead_id = l.id LEFT JOIN templates t ON m.template_id = t.id ORDER BY m.created_at DESC LIMIT ?`).all(limit);
    res.json(msgs);
  } catch (error) { res.status(500).json({ error: error.message }); }
});

router.get('/daily-stats', (req, res) => {
  try {
    const days = parseInt(req.query.days || '14');
    const stats = db.prepare('SELECT * FROM daily_stats ORDER BY date DESC LIMIT ?').all(days);
    res.json(stats.reverse());
  } catch (error) { res.status(500).json({ error: error.message }); }
});

router.get('/upcoming', (req, res) => {
  try {
    const limit = parseInt(req.query.limit || '15');
    const upcoming = db.prepare(`SELECT l.id, l.x_handle, l.display_name, l.status, l.current_step, l.next_followup_at, s.name as sequence_name, s.steps as sequence_steps FROM leads l JOIN sequences s ON l.sequence_id = s.id WHERE l.next_followup_at IS NOT NULL AND l.status NOT IN ('replied','converted','paused','blocked','no_response') ORDER BY l.next_followup_at ASC LIMIT ?`).all(limit);
    const parsed = upcoming.map(u => {
      const steps = JSON.parse(u.sequence_steps);
      return { ...u, current_step_info: steps[u.current_step] || {}, sequence_steps: undefined };
    });
    res.json(parsed);
  } catch (error) { res.status(500).json({ error: error.message }); }
});

export default router;
