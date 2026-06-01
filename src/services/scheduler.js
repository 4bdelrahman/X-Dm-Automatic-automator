/**
 * Follow-Up Scheduler Service
 * Runs periodic checks to send scheduled follow-up DMs
 */

import cron from 'node-cron';
import { v4 as uuidv4 } from 'uuid';
import db from '../config/database.js';
import { sendDM } from './twitter.js';
import { buildMessage } from './messageBuilder.js';
import { canSendNow, recordSend, recordFailure, getRandomDelay } from './rateLimiter.js';

let schedulerTask = null;
let isProcessing = false;
let schedulerStatus = 'stopped';

/**
 * Initialize the cron scheduler
 * Runs every 5 minutes to check for due follow-ups
 */
export function initScheduler() {
  // Run every 5 minutes
  schedulerTask = cron.schedule('*/5 * * * *', async () => {
    if (isProcessing) {
      console.log('⏳ Scheduler: Already processing, skipping this tick...');
      return;
    }
    await processFollowUps();
  });

  schedulerStatus = 'running';
  console.log('⏰ Scheduler initialized — checking for follow-ups every 5 minutes');
}

/**
 * Process all due follow-ups
 */
async function processFollowUps() {
  isProcessing = true;
  const isDryRun = (process.env.MODE || 'dry-run') === 'dry-run';

  try {
    // Get all leads with pending follow-ups
    const now = new Date().toISOString();
    const dueLeads = db.prepare(`
      SELECT l.*, s.steps as sequence_steps
      FROM leads l
      JOIN sequences s ON l.sequence_id = s.id
      WHERE l.next_followup_at IS NOT NULL
        AND l.next_followup_at <= ?
        AND l.status NOT IN ('replied', 'converted', 'paused', 'blocked', 'no_response')
        AND s.is_active = 1
      ORDER BY l.next_followup_at ASC
    `).all(now);

    if (dueLeads.length === 0) {
      return;
    }

    console.log(`\n📬 Scheduler: Found ${dueLeads.length} due follow-ups`);

    for (const lead of dueLeads) {
      // Check rate limits before each send
      const rateCheck = canSendNow();
      if (!rateCheck.canSend) {
        console.log(`⏸️  Rate limit: ${rateCheck.reason}`);
        break; // Stop processing, will retry next tick
      }

      const steps = JSON.parse(lead.sequence_steps);
      const currentStep = lead.current_step;

      // Check if we've exceeded the sequence
      if (currentStep >= steps.length) {
        // Mark as no_response — all follow-ups exhausted
        db.prepare(`
          UPDATE leads SET status = 'no_response', next_followup_at = NULL, updated_at = datetime('now')
          WHERE id = ?
        `).run(lead.id);
        console.log(`🔕 @${lead.x_handle}: All follow-ups sent, marked as no_response`);
        continue;
      }

      const step = steps[currentStep];

      // Get the template for this step
      const template = db.prepare(`
        SELECT * FROM templates WHERE name = ?
      `).get(step.template_name);

      if (!template) {
        console.error(`❌ Template "${step.template_name}" not found for @${lead.x_handle}`);
        continue;
      }

      // Build the personalized message
      const variables = {
        firstName: lead.display_name || lead.x_handle,
        handle: lead.x_handle,
        topic: extractTopic(lead),
        customNote: lead.notes || ''
      };

      const message = buildMessage(template.content, variables);

      // Send the DM (or dry-run)
      const result = await sendDM(lead.x_handle, message, isDryRun);

      // Log the message
      const messageId = uuidv4();
      db.prepare(`
        INSERT INTO messages (id, lead_id, template_id, sequence_id, step_number, content, status, sent_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        messageId,
        lead.id,
        template.id,
        lead.sequence_id,
        currentStep,
        message,
        result.success ? (isDryRun ? 'dry_run' : 'sent') : 'failed',
        result.success ? new Date().toISOString() : null
      );

      if (result.success) {
        recordSend();

        // Calculate next follow-up time
        const nextStep = currentStep + 1;
        let nextFollowupAt = null;
        let newStatus = getStatusForStep(currentStep);

        if (nextStep < steps.length) {
          const nextStepConfig = steps[nextStep];
          const nextDate = new Date();
          nextDate.setDate(nextDate.getDate() + nextStepConfig.delay_days);
          nextFollowupAt = nextDate.toISOString();
        } else {
          newStatus = 'no_response';
        }

        // Update lead
        db.prepare(`
          UPDATE leads
          SET current_step = ?, status = ?, next_followup_at = ?, updated_at = datetime('now')
          WHERE id = ?
        `).run(nextStep, newStatus, nextFollowupAt, lead.id);

        console.log(`${isDryRun ? '🧪' : '✅'} @${lead.x_handle}: Step ${currentStep} ${isDryRun ? '(dry run)' : 'sent'}${nextFollowupAt ? ` → next in ${steps[nextStep]?.delay_days} days` : ' → DONE'}`);

        // Wait a random delay before next message
        if (dueLeads.indexOf(lead) < dueLeads.length - 1) {
          const delay = getRandomDelay();
          console.log(`⏱️  Waiting ${Math.ceil(delay / 1000)}s before next message...`);
          await new Promise(resolve => setTimeout(resolve, delay));
        }
      } else {
        recordFailure();
        // Update message with error
        db.prepare(`UPDATE messages SET error = ? WHERE id = ?`).run(result.error, messageId);
        console.log(`❌ @${lead.x_handle}: Step ${currentStep} failed — ${result.error}`);
      }
    }
  } catch (error) {
    console.error('❌ Scheduler error:', error.message);
  } finally {
    isProcessing = false;
  }
}

/**
 * Start a sequence for a lead
 * @param {string} leadId - Lead ID
 * @param {string} sequenceId - Sequence ID to start
 */
export function startSequence(leadId, sequenceId) {
  const sequence = db.prepare('SELECT * FROM sequences WHERE id = ?').get(sequenceId);
  if (!sequence) throw new Error('Sequence not found');

  const steps = JSON.parse(sequence.steps);
  if (steps.length === 0) throw new Error('Sequence has no steps');

  // Calculate when the first follow-up is due
  const firstStep = steps[0];
  const nextDate = new Date();
  nextDate.setDate(nextDate.getDate() + firstStep.delay_days);

  db.prepare(`
    UPDATE leads
    SET sequence_id = ?, current_step = 0, status = 'contacted',
        next_followup_at = ?, updated_at = datetime('now')
    WHERE id = ?
  `).run(sequenceId, nextDate.toISOString(), leadId);

  return { success: true, nextFollowup: nextDate.toISOString() };
}

/**
 * Pause the scheduler
 */
export function pauseScheduler() {
  if (schedulerTask) {
    schedulerTask.stop();
    schedulerStatus = 'paused';
  }
}

/**
 * Resume the scheduler
 */
export function resumeScheduler() {
  if (schedulerTask) {
    schedulerTask.start();
    schedulerStatus = 'running';
  }
}

/**
 * Get scheduler status
 */
export function getSchedulerStatus() {
  return {
    status: schedulerStatus,
    isProcessing,
    mode: process.env.MODE || 'dry-run'
  };
}

/**
 * Manually trigger follow-up processing
 */
export async function triggerProcessing() {
  if (isProcessing) {
    return { success: false, message: 'Already processing' };
  }
  await processFollowUps();
  return { success: true, message: 'Processing complete' };
}

// ─── Helpers ──────────────────────────────────────────────────────────

function getStatusForStep(step) {
  if (step === 0) return 'contacted';
  return `follow_up_${step}`;
}

function extractTopic(lead) {
  // Try to extract a topic from tags or notes
  try {
    const tags = JSON.parse(lead.tags || '[]');
    if (tags.length > 0) return tags[0];
  } catch (e) {}

  if (lead.notes) {
    const words = lead.notes.split(' ').slice(0, 3).join(' ');
    return words;
  }

  return 'your work';
}
