/**
 * Leads API Routes
 * CRUD operations for managing outreach leads
 */

import { Router } from 'express';
import { v4 as uuidv4 } from 'uuid';
import db from '../config/database.js';
import { startSequence } from '../services/scheduler.js';

const router = Router();

// GET /api/leads — List all leads with optional filters
router.get('/', (req, res) => {
  try {
    const { status, tag, search, page = 1, limit = 50 } = req.query;
    const offset = (page - 1) * limit;

    let query = 'SELECT * FROM leads WHERE 1=1';
    let countQuery = 'SELECT COUNT(*) as total FROM leads WHERE 1=1';
    const params = [];
    const countParams = [];

    if (status) {
      query += ' AND status = ?';
      countQuery += ' AND status = ?';
      params.push(status);
      countParams.push(status);
    }

    if (search) {
      query += ' AND (x_handle LIKE ? OR display_name LIKE ? OR notes LIKE ?)';
      countQuery += ' AND (x_handle LIKE ? OR display_name LIKE ? OR notes LIKE ?)';
      const searchTerm = `%${search}%`;
      params.push(searchTerm, searchTerm, searchTerm);
      countParams.push(searchTerm, searchTerm, searchTerm);
    }

    if (tag) {
      query += ' AND tags LIKE ?';
      countQuery += ' AND tags LIKE ?';
      params.push(`%"${tag}"%`);
      countParams.push(`%"${tag}"%`);
    }

    query += ' ORDER BY created_at DESC LIMIT ? OFFSET ?';
    params.push(parseInt(limit), parseInt(offset));

    const leads = db.prepare(query).all(...params);
    const { total } = db.prepare(countQuery).get(...countParams);

    // Parse JSON fields
    const parsed = leads.map(l => ({
      ...l,
      tags: JSON.parse(l.tags || '[]')
    }));

    res.json({
      leads: parsed,
      total,
      page: parseInt(page),
      limit: parseInt(limit),
      totalPages: Math.ceil(total / limit)
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// GET /api/leads/stats — Lead status breakdown
router.get('/stats', (req, res) => {
  try {
    const stats = db.prepare(`
      SELECT status, COUNT(*) as count FROM leads GROUP BY status
    `).all();

    const total = db.prepare('SELECT COUNT(*) as count FROM leads').get();

    res.json({ stats, total: total.count });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// GET /api/leads/:id — Get single lead
router.get('/:id', (req, res) => {
  try {
    const lead = db.prepare('SELECT * FROM leads WHERE id = ?').get(req.params.id);
    if (!lead) return res.status(404).json({ error: 'Lead not found' });

    lead.tags = JSON.parse(lead.tags || '[]');

    // Get message history for this lead
    const messages = db.prepare(`
      SELECT m.*, t.name as template_name
      FROM messages m
      LEFT JOIN templates t ON m.template_id = t.id
      WHERE m.lead_id = ?
      ORDER BY m.created_at DESC
    `).all(req.params.id);

    res.json({ lead, messages });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// POST /api/leads — Create a new lead
router.post('/', (req, res) => {
  try {
    const { x_handle, display_name, bio, notes, tags } = req.body;

    if (!x_handle) {
      return res.status(400).json({ error: 'x_handle is required' });
    }

    const cleanHandle = x_handle.replace('@', '').trim();

    // Check for duplicate
    const existing = db.prepare('SELECT id FROM leads WHERE x_handle = ?').get(cleanHandle);
    if (existing) {
      return res.status(409).json({ error: 'Lead already exists', existingId: existing.id });
    }

    const id = uuidv4();
    db.prepare(`
      INSERT INTO leads (id, x_handle, display_name, bio, notes, tags)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(id, cleanHandle, display_name || '', bio || '', notes || '', JSON.stringify(tags || []));

    const lead = db.prepare('SELECT * FROM leads WHERE id = ?').get(id);
    lead.tags = JSON.parse(lead.tags);

    res.status(201).json(lead);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// POST /api/leads/bulk — Import multiple leads
router.post('/bulk', (req, res) => {
  try {
    const { leads } = req.body;
    if (!Array.isArray(leads) || leads.length === 0) {
      return res.status(400).json({ error: 'leads array is required' });
    }

    const insert = db.prepare(`
      INSERT OR IGNORE INTO leads (id, x_handle, display_name, bio, notes, tags)
      VALUES (?, ?, ?, ?, ?, ?)
    `);

    const results = { created: 0, skipped: 0, errors: [] };

    const transaction = db.transaction(() => {
      for (const lead of leads) {
        try {
          const handle = (lead.x_handle || lead.handle || '').replace('@', '').trim();
          if (!handle) {
            results.errors.push(`Missing handle for entry`);
            continue;
          }

          const result = insert.run(
            uuidv4(),
            handle,
            lead.display_name || lead.name || '',
            lead.bio || '',
            lead.notes || '',
            JSON.stringify(lead.tags || [])
          );

          if (result.changes > 0) results.created++;
          else results.skipped++;
        } catch (err) {
          results.errors.push(`${lead.x_handle}: ${err.message}`);
        }
      }
    });

    transaction();

    // Update daily stats
    const today = new Date().toISOString().split('T')[0];
    db.prepare(`
      INSERT INTO daily_stats (date, new_leads) VALUES (?, ?)
      ON CONFLICT(date) DO UPDATE SET new_leads = new_leads + ?
    `).run(today, results.created, results.created);

    res.json(results);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// PUT /api/leads/:id — Update a lead
router.put('/:id', (req, res) => {
  try {
    const lead = db.prepare('SELECT * FROM leads WHERE id = ?').get(req.params.id);
    if (!lead) return res.status(404).json({ error: 'Lead not found' });

    const { display_name, bio, notes, tags, status } = req.body;

    db.prepare(`
      UPDATE leads
      SET display_name = COALESCE(?, display_name),
          bio = COALESCE(?, bio),
          notes = COALESCE(?, notes),
          tags = COALESCE(?, tags),
          status = COALESCE(?, status),
          updated_at = datetime('now')
      WHERE id = ?
    `).run(
      display_name,
      bio,
      notes,
      tags ? JSON.stringify(tags) : null,
      status,
      req.params.id
    );

    const updated = db.prepare('SELECT * FROM leads WHERE id = ?').get(req.params.id);
    updated.tags = JSON.parse(updated.tags);
    res.json(updated);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// POST /api/leads/:id/start-sequence — Start a follow-up sequence for a lead
router.post('/:id/start-sequence', (req, res) => {
  try {
    const { sequenceId } = req.body;

    const lead = db.prepare('SELECT * FROM leads WHERE id = ?').get(req.params.id);
    if (!lead) return res.status(404).json({ error: 'Lead not found' });

    // If no sequence specified, use the first active one
    let seqId = sequenceId;
    if (!seqId) {
      const defaultSeq = db.prepare('SELECT id FROM sequences WHERE is_active = 1 LIMIT 1').get();
      if (!defaultSeq) return res.status(400).json({ error: 'No active sequences found' });
      seqId = defaultSeq.id;
    }

    const result = startSequence(req.params.id, seqId);
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// POST /api/leads/start-sequence-bulk — Start sequence for multiple leads
router.post('/start-sequence-bulk', (req, res) => {
  try {
    const { leadIds, sequenceId } = req.body;

    if (!Array.isArray(leadIds) || leadIds.length === 0) {
      return res.status(400).json({ error: 'leadIds array is required' });
    }

    let seqId = sequenceId;
    if (!seqId) {
      const defaultSeq = db.prepare('SELECT id FROM sequences WHERE is_active = 1 LIMIT 1').get();
      if (!defaultSeq) return res.status(400).json({ error: 'No active sequences found' });
      seqId = defaultSeq.id;
    }

    const results = { started: 0, errors: [] };

    for (const leadId of leadIds) {
      try {
        startSequence(leadId, seqId);
        results.started++;
      } catch (err) {
        results.errors.push({ leadId, error: err.message });
      }
    }

    res.json(results);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// DELETE /api/leads/:id — Delete a lead
router.delete('/:id', (req, res) => {
  try {
    // Delete associated messages first
    db.prepare('DELETE FROM messages WHERE lead_id = ?').run(req.params.id);
    const result = db.prepare('DELETE FROM leads WHERE id = ?').run(req.params.id);

    if (result.changes === 0) return res.status(404).json({ error: 'Lead not found' });
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

export default router;
