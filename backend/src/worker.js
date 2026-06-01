const { chromium } = require('playwright');
const sheetsManager = require('./sheets');

// ─── IN-MEMORY STATE ──────────────────────────────────────────
let campaignState = {
  isRunning: false,
  isPaused: false,
  totalLeads: 0,
  sent: 0,
  failed: 0,
  skipped: 0,
  currentLead: null,
  startedAt: null,
  logs: [],         // Rolling last 200 log entries
};

let stopSignal = false; // Set to true when stop is requested

// ─── LOGGER ───────────────────────────────────────────────────
function log(level, message, data = {}) {
  const entry = {
    timestamp: new Date().toISOString(),
    level,        // 'info' | 'success' | 'error' | 'warn'
    message,
    ...data,
  };
  console.log(`[${level.toUpperCase()}] ${message}`, data);
  campaignState.logs.unshift(entry);              // newest first
  if (campaignState.logs.length > 200) {
    campaignState.logs = campaignState.logs.slice(0, 200); // cap at 200
  }
}

// ─── GET STATE ────────────────────────────────────────────────
function getState() {
  return { ...campaignState };
}

// ─── STOP CAMPAIGN ────────────────────────────────────────────
function stopCampaign() {
  stopSignal = true;
  campaignState.isPaused = false;
  log('warn', 'Stop signal sent. Will stop after current DM completes.');
}

// ─── DELAY HELPER ─────────────────────────────────────────────
function randomDelay(minMs, maxMs) {
  const delay = Math.floor(Math.random() * (maxMs - minMs + 1)) + minMs;
  return new Promise((resolve) => setTimeout(resolve, delay));
}

async function typeHuman(element, text) {
  for (const char of text) {
    await element.type(char, { delay: 30 + Math.random() * 120 });
    // Occasionally pause longer (simulates thinking)
    if (Math.random() < 0.05) {
      await randomDelay(300, 800);
    }
  }
}

// ─── SEND A SINGLE DM ─────────────────────────────────────────
async function sendDM(page, lead, messageTemplate) {
  try {
    const handle = lead.twitter_handle || lead.handle || lead.username || lead.x_handle;
    if (!handle) throw new Error('No Twitter handle found for lead');

    const cleanHandle = handle.replace('@', '').trim();
    const message = messageTemplate
      .replace('{{name}}', lead.name || lead.first_name || lead.display_name || 'there')
      .replace('{{company}}', lead.company || '')
      .replace('{{handle}}', cleanHandle);

    log('info', `Navigating to compose DM for ${cleanHandle}`, { handle: cleanHandle });

    // Method: Use X's compose DM URL
    await page.goto(`https://x.com/messages`, { waitUntil: 'domcontentloaded', timeout: 20000 });
    await randomDelay(2000, 4000);

    // Click the new message button (compose icon)
    const newMsgBtn = await page.waitForSelector('[data-testid="NewDM_Button"], [aria-label="New message"]', { timeout: 10000 });
    await newMsgBtn.click();
    await randomDelay(1500, 3000);

    // Search for the user in the compose modal
    const searchInput = await page.waitForSelector('[data-testid="searchPeople"], input[placeholder*="Search"]', { timeout: 10000 });
    await typeHuman(searchInput, cleanHandle);
    await randomDelay(2000, 4000);

    // Select the user from results
    const userResult = await page.waitForSelector(`[data-testid="TypeaheadUser"]`, { timeout: 10000 });
    await userResult.click();
    await randomDelay(1000, 2000);

    // Click Next button
    const nextBtn = await page.waitForSelector('[data-testid="nextButton"]', { timeout: 5000 });
    await nextBtn.click();
    await randomDelay(1500, 3000);

    // Type the message in the DM text box
    const msgBox = await page.waitForSelector('[data-testid="dmComposerTextInput"], [role="textbox"]', { timeout: 10000 });
    await typeHuman(msgBox, message);
    await randomDelay(1000, 2000);

    // Send the message
    const sendButton = await page.waitForSelector('[data-testid="dmComposerSendButton"], [aria-label="Send"]', { timeout: 5000 });
    await sendButton.click();
    await randomDelay(2000, 4000);

    return { success: true, handle: cleanHandle, message };
  } catch (error) {
    return { success: false, handle: lead.twitter_handle, error: error.message };
  }
}

// ─── LOGIN TO X ───────────────────────────────────────────────
async function loginToX(page) {
  log('info', 'Logging into X...');

  await page.goto('https://x.com/login', { waitUntil: 'networkidle' });
  await randomDelay(2000, 3000);

  // Username
  await page.fill('[autocomplete="username"]', process.env.X_USERNAME);
  await page.keyboard.press('Enter');
  await randomDelay(2000, 3000);

  // Handle "enter your phone/email" intermediate step X sometimes shows
  const currentUrl = page.url();
  if (currentUrl.includes('challenge') || await page.$('[data-testid="ocfEnterTextTextInput"]')) {
    await page.fill('[data-testid="ocfEnterTextTextInput"]', process.env.X_EMAIL || process.env.X_USERNAME);
    await page.keyboard.press('Enter');
    await randomDelay(2000, 3000);
  }

  // Password
  await page.fill('[name="password"]', process.env.X_PASSWORD);
  await page.keyboard.press('Enter');
  await randomDelay(4000, 6000);

  // Verify login succeeded
  const isLoggedIn = await page.url().includes('home') || await page.$('[data-testid="SideNav_AccountSwitcher_Button"]');
  if (!isLoggedIn) throw new Error('Login to X failed. Check credentials or handle 2FA.');

  log('success', 'Logged into X successfully');
}

// ─── MAIN CAMPAIGN RUNNER ─────────────────────────────────────
async function runCampaign(options = {}) {
  const {
    messageTemplate = process.env.DM_TEMPLATE || 'Hey {{name}}, saw your work and wanted to reach out!',
    delayMinMs = parseInt(process.env.DELAY_MIN_MS || '45000'),   // 45s default
    delayMaxMs = parseInt(process.env.DELAY_MAX_MS || '90000'),   // 90s default
    maxDmsPerRun = parseInt(process.env.MAX_DMS_PER_RUN || '20'), // 20 DMs max
    statusColumn = process.env.STATUS_COLUMN || 'Z',
    resumeFromRow = 0, // 0 = auto-detect from sheet
  } = options;

  if (campaignState.isRunning) {
    throw new Error('Campaign is already running');
  }

  stopSignal = false;
  campaignState = {
    isRunning: true,
    isPaused: false,
    totalLeads: 0,
    sent: 0,
    failed: 0,
    skipped: 0,
    currentLead: null,
    startedAt: new Date().toISOString(),
    logs: campaignState.logs, // Preserve logs across runs
  };

  let browser;

  try {
    // ── Initialize Google Sheets ──────────────────────────────
    log('info', 'Connecting to Google Sheets...');
    await sheetsManager.init();
    const leads = await sheetsManager.getLeads();
    campaignState.totalLeads = leads.length;
    log('info', `Found ${leads.length} total leads in sheet`);

    // ── Filter leads that haven't been DMed yet ────────────────
    const pendingLeads = leads.filter(lead => {
      const status = lead.dm_status || lead.status || lead[Object.keys(lead).pop()];
      return !status || status === '' || status === 'pending';
    }).slice(0, maxDmsPerRun);

    if (pendingLeads.length === 0) {
      log('info', 'No pending leads found. All leads may already be processed.');
      campaignState.isRunning = false;
      return;
    }

    log('info', `Processing ${pendingLeads.length} pending leads (max ${maxDmsPerRun} per run)`);

    // ── Launch Browser ─────────────────────────────────────────
    log('info', 'Launching browser...');
    browser = await chromium.launch({
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
        '--single-process',
      ],
    });

    const context = await browser.newContext({
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      viewport: { width: 1280, height: 720 },
    });

    const page = await context.newPage();

    // ── Login to X ─────────────────────────────────────────────
    if (process.env.X_COOKIES) {
      log('info', 'Using provided X_COOKIES for authentication...');
      try {
        const cookies = JSON.parse(process.env.X_COOKIES);
        await context.addCookies(cookies);
        
        // Go to home to verify login and set up local storage/session properly
        await page.goto('https://x.com/home', { waitUntil: 'domcontentloaded' });
        await randomDelay(2000, 3000);
        log('success', 'Logged into X using cookies successfully');
      } catch (e) {
        log('error', 'Failed to use X_COOKIES. Ensure it is valid JSON.', { error: e.message });
        throw e;
      }
    } else {
      await loginToX(page);
    }

    // ── Send DMs ───────────────────────────────────────────────
    for (let i = 0; i < pendingLeads.length; i++) {
      if (stopSignal) {
        log('warn', 'Campaign stopped by user request.');
        break;
      }

      const lead = pendingLeads[i];
      campaignState.currentLead = lead.twitter_handle || lead.handle || lead.x_handle;

      log('info', `[${i + 1}/${pendingLeads.length}] Processing lead`, {
        handle: campaignState.currentLead,
        rowIndex: lead._rowIndex,
      });

      const result = await sendDM(page, lead, messageTemplate);

      if (result.success) {
        campaignState.sent++;
        log('success', `✓ DM sent to @${result.handle}`, { handle: result.handle });
        await sheetsManager.markLeadStatus(lead._rowIndex, 'sent', statusColumn);
      } else {
        campaignState.failed++;
        log('error', `✗ DM failed for @${lead.twitter_handle}`, { error: result.error });
        await sheetsManager.markLeadStatus(lead._rowIndex, `failed: ${result.error}`, statusColumn);
      }

      // Wait between DMs (only if not the last one)
      if (i < pendingLeads.length - 1 && !stopSignal) {
        const waitMs = Math.floor(Math.random() * (delayMaxMs - delayMinMs + 1)) + delayMinMs;
        const waitSec = Math.round(waitMs / 1000);
        log('info', `Waiting ${waitSec}s before next DM...`);
        await randomDelay(delayMinMs, delayMaxMs);
      }
    }

    log('success', `Campaign complete. Sent: ${campaignState.sent}, Failed: ${campaignState.failed}`);

  } catch (error) {
    log('error', `Campaign error: ${error.message}`, { stack: error.stack });
    throw error;
  } finally {
    if (browser) {
      await browser.close();
      log('info', 'Browser closed');
    }
    campaignState.isRunning = false;
    campaignState.currentLead = null;
  }
}

module.exports = { runCampaign, stopCampaign, getState };
