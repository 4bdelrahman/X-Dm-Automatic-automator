/**
 * Rate Limiter Service
 * Ensures DMs are sent at safe, human-like intervals
 */

import db from '../config/database.js';

const MIN_DELAY = parseInt(process.env.MIN_DELAY_SECONDS || '120') * 1000;  // 2 min default
const MAX_DELAY = parseInt(process.env.MAX_DELAY_SECONDS || '600') * 1000;  // 10 min default
const MAX_DMS_PER_DAY = parseInt(process.env.MAX_DMS_PER_DAY || '30');
const SEND_HOURS_START = parseInt(process.env.SEND_HOURS_START || '9');
const SEND_HOURS_END = parseInt(process.env.SEND_HOURS_END || '21');

let lastSendTime = 0;
let dailySendCount = 0;
let currentDate = new Date().toISOString().split('T')[0];

/**
 * Check if we can send a DM right now
 * @returns {{ canSend: boolean, reason?: string, waitMs?: number }}
 */
export function canSendNow() {
  const now = new Date();
  const today = now.toISOString().split('T')[0];

  // Reset daily count if new day
  if (today !== currentDate) {
    currentDate = today;
    dailySendCount = getTodaysSentCount();
  }

  // Check daily limit
  if (dailySendCount >= MAX_DMS_PER_DAY) {
    return {
      canSend: false,
      reason: `Daily limit reached (${MAX_DMS_PER_DAY} DMs). Resets at midnight.`,
      waitMs: getMillisUntilMidnight()
    };
  }

  // Check send hours
  const hour = now.getHours();
  if (hour < SEND_HOURS_START || hour >= SEND_HOURS_END) {
    return {
      canSend: false,
      reason: `Outside send hours (${SEND_HOURS_START}:00 - ${SEND_HOURS_END}:00). Current hour: ${hour}:00`,
      waitMs: getMillisUntilSendWindow(hour)
    };
  }

  // Check minimum delay between messages
  const timeSinceLastSend = Date.now() - lastSendTime;
  if (timeSinceLastSend < MIN_DELAY) {
    const waitMs = MIN_DELAY - timeSinceLastSend;
    return {
      canSend: false,
      reason: `Rate limit: wait ${Math.ceil(waitMs / 1000)}s between messages`,
      waitMs
    };
  }

  return { canSend: true };
}

/**
 * Record that a DM was sent (updates rate limiter state)
 */
export function recordSend() {
  lastSendTime = Date.now();
  dailySendCount++;

  // Update daily stats in DB
  const today = new Date().toISOString().split('T')[0];
  db.prepare(`
    INSERT INTO daily_stats (date, dms_sent) VALUES (?, 1)
    ON CONFLICT(date) DO UPDATE SET dms_sent = dms_sent + 1
  `).run(today);
}

/**
 * Record a failed DM attempt
 */
export function recordFailure() {
  const today = new Date().toISOString().split('T')[0];
  db.prepare(`
    INSERT INTO daily_stats (date, dms_failed) VALUES (?, 1)
    ON CONFLICT(date) DO UPDATE SET dms_failed = dms_failed + 1
  `).run(today);
}

/**
 * Get a random delay to wait before the next message
 * @returns {number} Delay in milliseconds
 */
export function getRandomDelay() {
  return Math.floor(Math.random() * (MAX_DELAY - MIN_DELAY) + MIN_DELAY);
}

/**
 * Get the current rate limiter status
 */
export function getStatus() {
  const now = new Date();
  const hour = now.getHours();

  return {
    dailySent: dailySendCount,
    dailyLimit: MAX_DMS_PER_DAY,
    dailyRemaining: Math.max(0, MAX_DMS_PER_DAY - dailySendCount),
    isWithinSendHours: hour >= SEND_HOURS_START && hour < SEND_HOURS_END,
    sendHours: `${SEND_HOURS_START}:00 - ${SEND_HOURS_END}:00`,
    currentHour: `${hour}:00`,
    minDelaySeconds: MIN_DELAY / 1000,
    maxDelaySeconds: MAX_DELAY / 1000,
    lastSendAt: lastSendTime ? new Date(lastSendTime).toISOString() : null
  };
}

// ─── Helpers ──────────────────────────────────────────────────────────

function getTodaysSentCount() {
  const today = new Date().toISOString().split('T')[0];
  const row = db.prepare('SELECT dms_sent FROM daily_stats WHERE date = ?').get(today);
  return row ? row.dms_sent : 0;
}

function getMillisUntilMidnight() {
  const now = new Date();
  const midnight = new Date(now);
  midnight.setHours(24, 0, 0, 0);
  return midnight.getTime() - now.getTime();
}

function getMillisUntilSendWindow(currentHour) {
  if (currentHour >= SEND_HOURS_END) {
    // Wait until tomorrow's start hour
    return ((24 - currentHour + SEND_HOURS_START) * 60 * 60 * 1000);
  }
  // Wait until today's start hour
  return ((SEND_HOURS_START - currentHour) * 60 * 60 * 1000);
}
