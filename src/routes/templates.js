/**
 * Templates API Routes
 * CRUD operations for message templates
 */

import { Router } from 'express';
import { v4 as uuidv4 } from 'uuid';
import db from '../config/database.js';
import { buildMessage, extractVariables, validateTemplate } from '../services/messageBuilder.js';

const router = Router();

// GET /api/templates — List all templates
router.get('/', (req, res) => {
  try {
    const { category } = req.query;
    let query = 'SELECT * FROM templates';
    const params = [];

    if (category) {
      query += ' WHERE category = ?';
      params.push(category);
    }

    query += ' ORDER BY created_at DESC';
    const templates = db.prepare(query).all(...params);

    const parsed = templates.map(t => ({
      ...t,
      variables: JSON.parse(t.variables || '[]')
    }));

    res.json(parsed);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// GET /api/templates/:id — Get single template
router.get('/:id', (req, res) => {
  try {
    const template = db.prepare('SELECT * FROM templates WHERE id = ?').get(req.params.id);
    if (!template) return res.status(404).json({ error: 'Template not found' });

    template.variables = JSON.parse(template.variables || '[]');
    res.json(template);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// POST /api/templates — Create a new template
router.post('/', (req, res) => {
  try {
    const { name, content, category } = req.body;

    if (!name || !content) {
      return res.status(400).json({ error: 'name and content are required' });
    }

    const validation = validateTemplate(content);
    if (!validation.valid) {
      return res.status(400).json({ error: 'Invalid template', details: validation.errors });
    }

    const variables = extractVariables(content);
    const id = uuidv4();

    db.prepare(`
      INSERT INTO templates (id, name, content, variables, category)
      VALUES (?, ?, ?, ?, ?)
    `).run(id, name, content, JSON.stringify(variables), category || 'general');

    const template = db.prepare('SELECT * FROM templates WHERE id = ?').get(id);
    template.variables = JSON.parse(template.variables);
    res.status(201).json(template);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// PUT /api/templates/:id — Update a template
router.put('/:id', (req, res) => {
  try {
    const template = db.prepare('SELECT * FROM templates WHERE id = ?').get(req.params.id);
    if (!template) return res.status(404).json({ error: 'Template not found' });

    const { name, content, category } = req.body;

    if (content) {
      const validation = validateTemplate(content);
      if (!validation.valid) {
        return res.status(400).json({ error: 'Invalid template', details: validation.errors });
      }
    }

    const variables = content ? extractVariables(content) : undefined;

    db.prepare(`
      UPDATE templates
      SET name = COALESCE(?, name),
          content = COALESCE(?, content),
          variables = COALESCE(?, variables),
          category = COALESCE(?, category),
          updated_at = datetime('now')
      WHERE id = ?
    `).run(
      name,
      content,
      variables ? JSON.stringify(variables) : null,
      category,
      req.params.id
    );

    const updated = db.prepare('SELECT * FROM templates WHERE id = ?').get(req.params.id);
    updated.variables = JSON.parse(updated.variables);
    res.json(updated);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// POST /api/templates/:id/preview — Preview a template with sample variables
router.post('/:id/preview', (req, res) => {
  try {
    const template = db.prepare('SELECT * FROM templates WHERE id = ?').get(req.params.id);
    if (!template) return res.status(404).json({ error: 'Template not found' });

    const sampleVars = req.body.variables || {
      firstName: 'John',
      handle: 'johndoe',
      topic: 'AI automation',
      customNote: 'Your recent post on productivity was spot on!'
    };

    const preview = buildMessage(template.content, sampleVars);
    res.json({ preview, variables: sampleVars });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// DELETE /api/templates/:id — Delete a template
router.delete('/:id', (req, res) => {
  try {
    const result = db.prepare('DELETE FROM templates WHERE id = ?').run(req.params.id);
    if (result.changes === 0) return res.status(404).json({ error: 'Template not found' });
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

export default router;
