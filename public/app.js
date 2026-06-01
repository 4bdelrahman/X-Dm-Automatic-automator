/* ═══════════════════════════════════════════════════
   𝕏 Follow-Up Dashboard — Frontend Logic
═══════════════════════════════════════════════════ */

const API = '';
let currentPage = 'dashboard';
let leadsPage = 1;

// ── Navigation ─────────────────────────────────────
document.querySelectorAll('.nav-item').forEach(item => {
  item.addEventListener('click', e => {
    e.preventDefault();
    const page = item.dataset.page;
    switchPage(page);
  });
});

function switchPage(page) {
  currentPage = page;
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
  document.getElementById(`page-${page}`).classList.add('active');
  document.querySelector(`[data-page="${page}"]`).classList.add('active');

  if (page === 'dashboard') loadDashboard();
  else if (page === 'leads') loadLeads();
  else if (page === 'templates') loadTemplates();
  else if (page === 'sequences') loadSequences();
  else if (page === 'automation') loadAutomation();
}

// ── Toast ──────────────────────────────────────────
function toast(msg, type = 'success') {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.className = `toast ${type} show`;
  setTimeout(() => el.classList.remove('show'), 3000);
}

// ── Modal helpers ──────────────────────────────────
function openModal(id) { document.getElementById(id).classList.add('open'); }
function closeModal(id) { document.getElementById(id).classList.remove('open'); }

document.querySelectorAll('[data-close]').forEach(btn => {
  btn.addEventListener('click', () => closeModal(btn.dataset.close));
});

document.querySelectorAll('.modal-overlay').forEach(overlay => {
  overlay.addEventListener('click', e => {
    if (e.target === overlay) overlay.classList.remove('open');
  });
});

// ── API Helpers ────────────────────────────────────
async function api(path, opts = {}) {
  const res = await fetch(API + path, {
    headers: { 'Content-Type': 'application/json' },
    ...opts,
    body: opts.body ? JSON.stringify(opts.body) : undefined
  });
  return res.json();
}

function timeAgo(dateStr) {
  if (!dateStr) return '—';
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

function formatDate(dateStr) {
  if (!dateStr) return '—';
  const d = new Date(dateStr);
  const now = new Date();
  const diff = d.getTime() - now.getTime();
  const days = Math.floor(diff / 86400000);
  if (days < 0) return 'Overdue';
  if (days === 0) return 'Today';
  if (days === 1) return 'Tomorrow';
  return `In ${days} days`;
}

function statusBadge(status) {
  const labels = {
    new: '● New', contacted: '✉ Contacted', follow_up_1: '↻ Follow-up 1',
    follow_up_2: '↻ Follow-up 2', follow_up_3: '↻ Follow-up 3',
    replied: '✓ Replied', converted: '★ Converted',
    no_response: '✗ No Response', paused: '⏸ Paused', blocked: '⊘ Blocked'
  };
  return `<span class="badge badge-${status}">${labels[status] || status}</span>`;
}

// ══════════════════════════════════════════════════
//  DASHBOARD PAGE
// ══════════════════════════════════════════════════

async function loadDashboard() {
  try {
    const [overview, upcoming, activity] = await Promise.all([
      api('/api/dashboard/overview'),
      api('/api/dashboard/upcoming?limit=8'),
      api('/api/dashboard/recent-activity?limit=10')
    ]);

    document.getElementById('stat-total-leads').textContent = overview.totalLeads;
    document.getElementById('stat-sent').textContent = overview.totalMessagesSent;
    document.getElementById('stat-replied').textContent = overview.replied;
    document.getElementById('stat-conversion').textContent = overview.conversionRate + '%';
    document.getElementById('stat-pending').textContent = overview.pendingFollowups;
    document.getElementById('stat-daily-limit').textContent = overview.rateLimiter.dailyRemaining;
    document.getElementById('nav-leads-count').textContent = overview.totalLeads;

    // Scheduler status
    const schedDot = document.getElementById('scheduler-dot');
    schedDot.className = 'status-dot ' + (overview.scheduler.status === 'running' ? 'green' : 'yellow');
    document.getElementById('scheduler-label').textContent = overview.scheduler.status === 'running' ? 'Scheduler Running' : 'Scheduler ' + overview.scheduler.status;

    // Mode badge
    const modeBadge = document.getElementById('mode-badge');
    if (overview.scheduler.mode === 'live') {
      modeBadge.textContent = 'LIVE MODE';
      modeBadge.classList.add('live');
    } else {
      modeBadge.textContent = 'DRY RUN';
      modeBadge.classList.remove('live');
    }

    // Upcoming follow-ups
    const upEl = document.getElementById('upcoming-list');
    if (upcoming.length === 0) {
      upEl.innerHTML = '<div class="empty-state">No upcoming follow-ups.<br>Start a sequence for your leads!</div>';
    } else {
      upEl.innerHTML = upcoming.map(u => `
        <div class="activity-item">
          <div class="activity-icon">📬</div>
          <div class="activity-content">
            <div class="activity-title">@${u.x_handle} ${u.display_name ? `(${u.display_name})` : ''}</div>
            <div class="activity-meta">Step ${u.current_step + 1} — ${u.current_step_info.description || ''} — <strong>${formatDate(u.next_followup_at)}</strong></div>
          </div>
        </div>
      `).join('');
    }

    // Recent activity
    const actEl = document.getElementById('activity-list');
    if (activity.length === 0) {
      actEl.innerHTML = '<div class="empty-state">No activity yet. Send your first DM!</div>';
    } else {
      actEl.innerHTML = activity.map(a => {
        const icon = a.status === 'sent' ? '✅' : a.status === 'dry_run' ? '🧪' : a.status === 'failed' ? '❌' : '⏳';
        return `
          <div class="activity-item">
            <div class="activity-icon">${icon}</div>
            <div class="activity-content">
              <div class="activity-title">@${a.x_handle} — ${a.template_name || 'Manual'}</div>
              <div class="activity-meta">${a.status.toUpperCase()} · Step ${a.step_number} · ${timeAgo(a.created_at)}</div>
            </div>
          </div>`;
      }).join('');
    }
  } catch (err) {
    console.error('Dashboard load error:', err);
  }
}

// ══════════════════════════════════════════════════
//  LEADS PAGE
// ══════════════════════════════════════════════════

async function loadLeads() {
  const status = document.getElementById('leads-status-filter').value;
  const search = document.getElementById('leads-search').value;

  try {
    const [data, statsData] = await Promise.all([
      api(`/api/leads?page=${leadsPage}&limit=30&status=${status}&search=${encodeURIComponent(search)}`),
      api('/api/leads/stats')
    ]);

    // Status pills
    const pillsEl = document.getElementById('leads-status-pills');
    pillsEl.innerHTML = `<span class="status-pill ${!status ? 'active' : ''}" data-status="">All (${statsData.total})</span>` +
      statsData.stats.map(s => `<span class="status-pill ${status === s.status ? 'active' : ''}" data-status="${s.status}">${s.status.replace(/_/g,' ')} (${s.count})</span>`).join('');

    pillsEl.querySelectorAll('.status-pill').forEach(pill => {
      pill.addEventListener('click', () => {
        document.getElementById('leads-status-filter').value = pill.dataset.status;
        leadsPage = 1;
        loadLeads();
      });
    });

    // Table
    const tbody = document.getElementById('leads-tbody');
    if (data.leads.length === 0) {
      tbody.innerHTML = '<tr><td colspan="8" class="empty-state">No leads found. Add some leads to get started!</td></tr>';
    } else {
      tbody.innerHTML = data.leads.map(l => `
        <tr>
          <td><input type="checkbox" class="lead-check" value="${l.id}" /></td>
          <td class="handle-cell">@${l.x_handle}</td>
          <td>${l.display_name || '—'}</td>
          <td>${statusBadge(l.status)}</td>
          <td>${l.current_step || 0}</td>
          <td>${formatDate(l.next_followup_at)}</td>
          <td style="max-width:150px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${(l.notes||'').replace(/"/g,'&quot;')}">${l.notes || '—'}</td>
          <td>
            <button class="action-btn" onclick="editLead('${l.id}')" title="Edit">✏️</button>
            <button class="action-btn" onclick="startSeqForLead('${l.id}')" title="Start Sequence">▶</button>
            <button class="action-btn" onclick="deleteLead('${l.id}')" title="Delete">🗑️</button>
          </td>
        </tr>
      `).join('');
    }

    // Pagination
    const pagEl = document.getElementById('leads-pagination');
    if (data.totalPages > 1) {
      let html = `<span>Page ${data.page} of ${data.totalPages}</span>`;
      for (let i = 1; i <= data.totalPages; i++) {
        html += `<button class="${i === data.page ? 'current' : ''}" onclick="leadsPage=${i};loadLeads()">${i}</button>`;
      }
      pagEl.innerHTML = html;
    } else {
      pagEl.innerHTML = `<span>${data.total} leads total</span>`;
    }
  } catch (err) {
    console.error('Leads load error:', err);
  }
}

// Select all checkbox
document.getElementById('select-all-leads').addEventListener('change', e => {
  document.querySelectorAll('.lead-check').forEach(cb => cb.checked = e.target.checked);
});

// Search debounce
let searchTimeout;
document.getElementById('leads-search').addEventListener('input', () => {
  clearTimeout(searchTimeout);
  searchTimeout = setTimeout(() => { leadsPage = 1; loadLeads(); }, 400);
});

document.getElementById('leads-status-filter').addEventListener('change', () => { leadsPage = 1; loadLeads(); });

// Add Lead
document.getElementById('btn-add-lead').addEventListener('click', () => {
  document.getElementById('lead-id').value = '';
  document.getElementById('lead-handle').value = '';
  document.getElementById('lead-name').value = '';
  document.getElementById('lead-notes').value = '';
  document.getElementById('lead-tags').value = '';
  document.getElementById('modal-lead-title').textContent = 'Add Lead';
  openModal('modal-lead');
});

document.getElementById('btn-save-lead').addEventListener('click', async () => {
  const id = document.getElementById('lead-id').value;
  const body = {
    x_handle: document.getElementById('lead-handle').value,
    display_name: document.getElementById('lead-name').value,
    notes: document.getElementById('lead-notes').value,
    tags: document.getElementById('lead-tags').value.split(',').map(t => t.trim()).filter(Boolean)
  };

  try {
    if (id) {
      await api(`/api/leads/${id}`, { method: 'PUT', body });
      toast('Lead updated!');
    } else {
      await api('/api/leads', { method: 'POST', body });
      toast('Lead added!');
    }
    closeModal('modal-lead');
    loadLeads();
  } catch (err) {
    toast('Error: ' + err.message, 'error');
  }
});

window.editLead = async function(id) {
  const { lead } = await api(`/api/leads/${id}`);
  document.getElementById('lead-id').value = lead.id;
  document.getElementById('lead-handle').value = lead.x_handle;
  document.getElementById('lead-name').value = lead.display_name;
  document.getElementById('lead-notes').value = lead.notes;
  document.getElementById('lead-tags').value = (lead.tags || []).join(', ');
  document.getElementById('modal-lead-title').textContent = 'Edit Lead';
  openModal('modal-lead');
};

window.deleteLead = async function(id) {
  if (!confirm('Delete this lead and all their message history?')) return;
  await api(`/api/leads/${id}`, { method: 'DELETE' });
  toast('Lead deleted');
  loadLeads();
};

window.startSeqForLead = async function(id) {
  try {
    await api(`/api/leads/${id}/start-sequence`, { method: 'POST', body: {} });
    toast('Sequence started!');
    loadLeads();
  } catch (err) { toast('Error: ' + err.message, 'error'); }
};

// Bulk start sequence
document.getElementById('btn-start-seq-bulk').addEventListener('click', async () => {
  const ids = [...document.querySelectorAll('.lead-check:checked')].map(cb => cb.value);
  if (ids.length === 0) return toast('Select leads first', 'error');
  if (!confirm(`Start sequence for ${ids.length} leads?`)) return;
  const result = await api('/api/leads/start-sequence-bulk', { method: 'POST', body: { leadIds: ids } });
  toast(`Sequence started for ${result.started} leads!`);
  loadLeads();
});

// CSV Import
document.getElementById('btn-import-csv').addEventListener('click', () => {
  document.getElementById('csv-input').value = '';
  document.getElementById('import-result').innerHTML = '';
  openModal('modal-import');
});

document.getElementById('btn-do-import').addEventListener('click', async () => {
  const csv = document.getElementById('csv-input').value.trim();
  if (!csv) return toast('Paste CSV content first', 'error');

  const lines = csv.split('\n');
  const header = lines[0].toLowerCase().split(',').map(h => h.trim());
  const leads = [];

  for (let i = 1; i < lines.length; i++) {
    const vals = lines[i].split(',').map(v => v.trim().replace(/^"|"$/g, ''));
    const lead = {};
    header.forEach((h, idx) => lead[h] = vals[idx] || '');
    if (lead.tags) lead.tags = lead.tags.split(';').map(t => t.trim());
    leads.push(lead);
  }

  const result = await api('/api/leads/bulk', { method: 'POST', body: { leads } });
  document.getElementById('import-result').innerHTML = `
    <div class="info-box" style="margin-top:1rem">
      ✅ Created: <strong>${result.created}</strong> | ⏭️ Skipped: <strong>${result.skipped}</strong>
      ${result.errors?.length ? `| ❌ Errors: ${result.errors.length}` : ''}
    </div>`;
  toast(`Imported ${result.created} leads!`);
  loadLeads();
});

// ══════════════════════════════════════════════════
//  TEMPLATES PAGE
// ══════════════════════════════════════════════════

async function loadTemplates() {
  const templates = await api('/api/templates');
  const grid = document.getElementById('templates-grid');

  if (templates.length === 0) {
    grid.innerHTML = '<div class="empty-state">No templates yet. Create your first!</div>';
    return;
  }

  grid.innerHTML = templates.map(t => `
    <div class="template-card">
      <div class="template-card-header">
        <span class="template-name">${t.name}</span>
        <span class="template-category">${t.category}</span>
      </div>
      <div class="template-body">${t.content}</div>
      <div class="template-actions">
        <button class="btn btn-sm btn-outline" onclick="editTemplate('${t.id}')">✏️ Edit</button>
        <button class="btn btn-sm btn-outline" onclick="deleteTemplate('${t.id}')">🗑️ Delete</button>
      </div>
    </div>
  `).join('');
}

document.getElementById('btn-add-template').addEventListener('click', () => {
  document.getElementById('template-id').value = '';
  document.getElementById('template-name').value = '';
  document.getElementById('template-content').value = '';
  document.getElementById('template-category').value = 'general';
  document.getElementById('template-preview').textContent = 'Start typing to see preview...';
  document.getElementById('modal-template-title').textContent = 'New Template';
  openModal('modal-template');
});

// Live preview
document.getElementById('template-content').addEventListener('input', e => {
  const preview = e.target.value
    .replace(/\{firstName\}/gi, 'John')
    .replace(/\{handle\}/gi, 'johndoe')
    .replace(/\{topic\}/gi, 'AI automation')
    .replace(/\{customNote\}/gi, 'Your recent post was really insightful!');
  document.getElementById('template-preview').textContent = preview || 'Start typing...';
});

document.getElementById('btn-save-template').addEventListener('click', async () => {
  const id = document.getElementById('template-id').value;
  const body = {
    name: document.getElementById('template-name').value,
    content: document.getElementById('template-content').value,
    category: document.getElementById('template-category').value
  };

  if (!body.name || !body.content) return toast('Name and content required', 'error');

  if (id) {
    await api(`/api/templates/${id}`, { method: 'PUT', body });
    toast('Template updated!');
  } else {
    await api('/api/templates', { method: 'POST', body });
    toast('Template created!');
  }
  closeModal('modal-template');
  loadTemplates();
});

window.editTemplate = async function(id) {
  const t = await api(`/api/templates/${id}`);
  document.getElementById('template-id').value = t.id;
  document.getElementById('template-name').value = t.name;
  document.getElementById('template-content').value = t.content;
  document.getElementById('template-category').value = t.category;
  document.getElementById('template-preview').textContent = t.content;
  document.getElementById('modal-template-title').textContent = 'Edit Template';
  openModal('modal-template');
};

window.deleteTemplate = async function(id) {
  if (!confirm('Delete this template?')) return;
  await api(`/api/templates/${id}`, { method: 'DELETE' });
  toast('Template deleted');
  loadTemplates();
};

// ══════════════════════════════════════════════════
//  SEQUENCES PAGE
// ══════════════════════════════════════════════════

async function loadSequences() {
  const sequences = await api('/api/sequences');
  const list = document.getElementById('sequences-list');

  if (sequences.length === 0) {
    list.innerHTML = '<div class="empty-state">No sequences found.</div>';
    return;
  }

  list.innerHTML = sequences.map(s => `
    <div class="sequence-card">
      <div class="sequence-header">
        <div>
          <strong style="font-size:1rem">${s.name}</strong>
          <span style="color:var(--text-muted);font-size:0.8rem;margin-left:0.5rem">${s.description}</span>
        </div>
        <div style="display:flex;gap:0.75rem;align-items:center">
          <span class="badge badge-${s.is_active ? 'contacted' : 'no_response'}">${s.is_active ? '● Active' : '○ Inactive'}</span>
          <span style="font-size:0.8rem;color:var(--text-muted)">${s.lead_count} leads</span>
        </div>
      </div>
      <div class="sequence-body">
        <div class="sequence-steps">
          ${s.steps.map((step, i) => `
            <div class="sequence-step">
              <div class="step-node">
                <span class="step-num">Step ${i + 1}</span>
                <span class="step-name">${step.template_name || step.description}</span>
                <span class="step-delay">${step.delay_days === 0 ? 'Immediately' : `+${step.delay_days} day${step.delay_days > 1 ? 's' : ''}`}</span>
              </div>
              ${i < s.steps.length - 1 ? '<span class="step-arrow">→</span>' : ''}
            </div>
          `).join('')}
        </div>
      </div>
    </div>
  `).join('');
}

// ══════════════════════════════════════════════════
//  AUTOMATION PAGE
// ══════════════════════════════════════════════════

async function loadAutomation() {
  try {
    const status = await api('/api/automation/status');

    // Browser status
    const bDot = document.getElementById('browser-dot');
    const bText = document.getElementById('browser-status-text');
    if (status.browser.isRunning && status.browser.isLoggedIn) {
      bDot.className = 'status-dot green'; bText.textContent = 'Browser running & logged in ✓';
    } else if (status.browser.isRunning) {
      bDot.className = 'status-dot yellow'; bText.textContent = 'Browser running — not logged in';
    } else {
      bDot.className = 'status-dot red'; bText.textContent = 'Browser not running';
    }

    // Scheduler status
    const sDot = document.getElementById('sched-dot-auto');
    const sText = document.getElementById('sched-status-text');
    sDot.className = 'status-dot ' + (status.scheduler.status === 'running' ? 'green' : 'yellow');
    sText.textContent = `Scheduler: ${status.scheduler.status} (${status.mode} mode)`;

    // Mode highlights
    document.getElementById('mode-dry').style.borderColor = status.mode === 'dry-run' ? 'var(--accent)' : 'var(--border)';
    document.getElementById('mode-live').style.borderColor = status.mode === 'live' ? 'var(--green)' : 'var(--border)';

    // Rate limiter
    const rl = status.rateLimiter;
    document.getElementById('rate-limiter-body').innerHTML = `
      <div class="rate-stat"><span class="rate-stat-label">Sent today</span><span class="rate-stat-value">${rl.dailySent} / ${rl.dailyLimit}</span></div>
      <div class="rate-stat"><span class="rate-stat-label">Remaining</span><span class="rate-stat-value">${rl.dailyRemaining}</span></div>
      <div class="rate-stat"><span class="rate-stat-label">Send window</span><span class="rate-stat-value">${rl.sendHours}</span></div>
      <div class="rate-stat"><span class="rate-stat-label">In window now?</span><span class="rate-stat-value">${rl.isWithinSendHours ? '✅ Yes' : '⛔ No'}</span></div>
      <div class="rate-stat"><span class="rate-stat-label">Min delay</span><span class="rate-stat-value">${rl.minDelaySeconds}s</span></div>
      <div class="rate-stat"><span class="rate-stat-label">Max delay</span><span class="rate-stat-value">${rl.maxDelaySeconds}s</span></div>
      <div class="rate-stat"><span class="rate-stat-label">Last sent</span><span class="rate-stat-value">${rl.lastSendAt ? timeAgo(rl.lastSendAt) : 'Never'}</span></div>
    `;
  } catch (err) {
    console.error('Automation load error:', err);
  }
}

// Automation buttons
document.getElementById('btn-launch-browser').addEventListener('click', async () => {
  toast('Launching browser...');
  const r = await api('/api/automation/launch-browser', { method: 'POST' });
  toast(r.success ? 'Browser launched!' : 'Failed: ' + r.error, r.success ? 'success' : 'error');
  loadAutomation();
});

document.getElementById('btn-login').addEventListener('click', async () => {
  toast('Opening login page — log in manually in the browser window...');
  const r = await api('/api/automation/login', { method: 'POST' });
  toast(r.success ? 'Logged in! Session saved.' : 'Login failed: ' + r.error, r.success ? 'success' : 'error');
  loadAutomation();
});

document.getElementById('btn-close-browser').addEventListener('click', async () => {
  await api('/api/automation/close-browser', { method: 'POST' });
  toast('Browser closed');
  loadAutomation();
});

document.getElementById('btn-pause-sched').addEventListener('click', async () => {
  await api('/api/automation/pause', { method: 'POST' });
  toast('Scheduler paused');
  loadAutomation(); loadDashboard();
});

document.getElementById('btn-resume-sched').addEventListener('click', async () => {
  await api('/api/automation/resume', { method: 'POST' });
  toast('Scheduler resumed');
  loadAutomation(); loadDashboard();
});

document.getElementById('btn-trigger-now').addEventListener('click', async () => {
  toast('Processing follow-ups...');
  const r = await api('/api/automation/trigger', { method: 'POST' });
  toast(r.success ? 'Processing complete!' : r.message, r.success ? 'success' : 'error');
  loadDashboard();
});

document.getElementById('btn-trigger').addEventListener('click', async () => {
  toast('Processing follow-ups...');
  const r = await api('/api/automation/trigger', { method: 'POST' });
  toast(r.success ? 'Processing complete!' : r.message, r.success ? 'success' : 'error');
  loadDashboard();
});

// Test DM
document.getElementById('btn-send-test-dm').addEventListener('click', async () => {
  const handle = document.getElementById('test-dm-handle').value;
  const message = document.getElementById('test-dm-message').value;
  if (!handle || !message) return toast('Handle and message required', 'error');

  const r = await api('/api/automation/send-dm', { method: 'POST', body: { handle, message } });
  const el = document.getElementById('test-dm-result');
  el.innerHTML = `<div class="info-box" style="margin-top:0.75rem">${r.dryRun ? '🧪 DRY RUN' : r.success ? '✅ SENT' : '❌ FAILED'}: ${JSON.stringify(r).substring(0, 200)}</div>`;
});

// ══════════════════════════════════════════════════
//  SCRAPE DMs — Import contacts from X.com
// ══════════════════════════════════════════════════

async function scrapeDMs() {
  toast('Scraping DM contacts from X.com... This may take a minute.');
  const btn1 = document.getElementById('btn-scrape-dms');
  const btn2 = document.getElementById('btn-scrape-dms-auto');
  if (btn1) btn1.disabled = true;
  if (btn2) btn2.disabled = true;

  try {
    const r = await api('/api/automation/scrape-dms', { method: 'POST', body: { maxScroll: 20 } });

    if (!r.success) {
      toast('Scrape failed: ' + (r.error || 'Unknown error'), 'error');
      const el = document.getElementById('scrape-result');
      if (el) el.innerHTML = `<div class="info-box" style="border-color:var(--red)">❌ ${r.error}</div>`;
      return;
    }

    toast(`Imported ${r.created} new leads from ${r.totalScraped} DM contacts!`);

    const el = document.getElementById('scrape-result');
    if (el) {
      el.innerHTML = `
        <div class="info-box">
          ✅ Scraped <strong>${r.totalScraped}</strong> DM contacts<br/>
          📥 Imported: <strong>${r.created}</strong> new leads<br/>
          ⏭️ Skipped (already exist): <strong>${r.skipped}</strong>
        </div>`;
    }

    // Refresh leads page if visible
    if (currentPage === 'leads') loadLeads();
    loadDashboard();
  } catch (err) {
    toast('Error: ' + err.message, 'error');
  } finally {
    if (btn1) btn1.disabled = false;
    if (btn2) btn2.disabled = false;
  }
}

document.getElementById('btn-scrape-dms').addEventListener('click', scrapeDMs);
document.getElementById('btn-scrape-dms-auto').addEventListener('click', scrapeDMs);

// ── Initial Load ──────────────────────────────────
loadDashboard();

// Auto-refresh every 30s
setInterval(() => { if (currentPage === 'dashboard') loadDashboard(); }, 30000);
