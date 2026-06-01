/**
 * Sequences API Routes
 * CRUD for follow-up sequence configurations
 */

import { Router } from 'express';
import { v4 as uuidv4 } from 'uuid';
import db from '../config/database.js';

const router = Router();

// GET /api/sequences — List all sequences
router.get('/', (req, res) => {
  try {
    const sequences = db.prepare('SELECT * FROM sequences ORDER BY created_at DESC').all();

    const parsed = sequences.map(s => ({
      ...s,
      steps: JSON.parse(s.steps || '[]'),
      is_active: Boolean(s.is_active)
    }));

    // Add lead counts for each sequence
    for (const seq of parsed) {
      const count = db.prepare(
        'SELECT COUNT(*) as count FROM leads WHERE sequence_id = ?'
      ).get(seq.id);
      seq.lead_count = count.count;
    }

    res.json(parsed);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// GET /api/sequences/:id — Get a single sequence
router.get('/:id', (req, res) => {
  try {
    const sequence = db.prepare('SELECT * FROM sequences WHERE id = ?').get(req.params.id);
    if (!sequence) return res.status(404).json({ error: 'Sequence not found' });

    sequence.steps = JSON.parse(sequence.steps || '[]');
    sequence.is_active = Boolean(sequence.is_active);

    // Get leads in this sequence
    const leads = db.prepare(
      'SELECT id, x_handle, display_name, status, current_step, next_followup_at FROM leads WHERE sequence_id = ?'
    ).all(req.params.id);

    res.json({ sequence, leads });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// POST /api/sequences — Create a new sequence
router.post('/', (req, res) => {
  try {
    const { name, description, steps } = req.body;

    if (!name) return res.status(400).json({ error: 'name is required' });
    if (!Array.isArray(steps) || steps.length === 0) {
      return res.status(400).json({ error: 'steps array is required' });
    }

    const id = uuidv4();
    db.prepare(`
      INSERT INTO sequences (id, name, description, steps)
      VALUES (?, ?, ?, ?)
    `).run(id, name, description || '', JSON.stringify(steps));

    const sequence = db.prepare('SELECT * FROM sequences WHERE id = ?').get(id);
    sequence.steps = JSON.parse(sequence.steps);
    sequence.is_active = Boolean(sequence.is_active);

    res.status(201).json(sequence);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// PUT /api/sequences/:id — Update a sequence
router.put('/:id', (req, res) => {
  try {
    const sequence = db.prepare('SELECT * FROM sequences WHERE id = ?').get(req.params.id);
    if (!sequence) return res.status(404).json({ error: 'Sequence not found' });

    const { name, description, steps, is_active } = req.body;

    db.prepare(`
      UPDATE sequences
      SET name = COALESCE(?, name),
          description = COALESCE(?, description),
          steps = COALESCE(?, steps),
          is_active = COALESCE(?, is_active),
          updated_at = datetime('now')
      WHERE id = ?
    `).run(
      name,
      description,
      steps ? JSON.stringify(steps) : null,
      is_active !== undefined ? (is_active ? 1 : 0) : null,
      req.params.id
    );

    const updated = db.prepare('SELECT * FROM sequences WHERE id = ?').get(req.params.id);
    updated.steps = JSON.parse(updated.steps);
    updated.is_active = Boolean(updated.is_active);

    res.json(updated);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// DELETE /api/sequences/:id — Delete a sequence
router.delete('/:id', (req, res) => {
  try {
    // Unassign leads from this sequence
    db.prepare('UPDATE leads SET sequence_id = NULL WHERE sequence_id = ?').run(req.params.id);

    const result = db.prepare('DELETE FROM sequences WHERE id = ?').run(req.params.id);
    if (result.changes === 0) return res.status(404).json({ error: 'Sequence not found' });

    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

export default router;
