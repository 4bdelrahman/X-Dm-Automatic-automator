/**
 * Lead Import Script
 * Usage: node scripts/import-leads.js <file.csv|file.json>
 * 
 * CSV format: x_handle,display_name,notes,tags
 * JSON format: [{ "x_handle": "...", "display_name": "...", "notes": "...", "tags": ["..."] }]
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const file = process.argv[2];

if (!file) {
  console.log('Usage: node scripts/import-leads.js <file.csv|file.json>');
  console.log('\nCSV format: x_handle,display_name,notes,tags');
  console.log('JSON format: [{ "x_handle": "...", "display_name": "...", "notes": "...", "tags": ["tag1"] }]');
  process.exit(1);
}

const filePath = path.resolve(file);
if (!fs.existsSync(filePath)) {
  console.error(`File not found: ${filePath}`);
  process.exit(1);
}

const content = fs.readFileSync(filePath, 'utf-8');
let leads = [];

if (filePath.endsWith('.json')) {
  leads = JSON.parse(content);
} else if (filePath.endsWith('.csv')) {
  const lines = content.trim().split('\n');
  const header = lines[0].toLowerCase().split(',').map(h => h.trim());
  for (let i = 1; i < lines.length; i++) {
    const values = lines[i].split(',').map(v => v.trim().replace(/^"|"$/g, ''));
    const lead = {};
    header.forEach((h, idx) => { lead[h] = values[idx] || ''; });
    if (lead.tags) {
      try { lead.tags = JSON.parse(lead.tags); } catch { lead.tags = lead.tags.split(';').map(t => t.trim()); }
    }
    leads.push(lead);
  }
}

console.log(`Found ${leads.length} leads to import`);

const response = await fetch(`http://localhost:${process.env.PORT || 3000}/api/leads/bulk`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ leads })
});

const result = await response.json();
console.log(`✅ Created: ${result.created}`);
console.log(`⏭️  Skipped (duplicates): ${result.skipped}`);
if (result.errors?.length > 0) console.log(`❌ Errors: ${result.errors.join(', ')}`);
