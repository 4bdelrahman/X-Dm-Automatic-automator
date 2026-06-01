/**
 * X.com Browser Automation Service
 * Uses Playwright to automate DM sending on X.com
 * Supports login persistence via browser context storage
 */

import { chromium } from 'playwright';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BROWSER_DATA_DIR = path.join(__dirname, '..', '..', 'browser-data');
const STORAGE_FILE = path.join(BROWSER_DATA_DIR, 'auth-state.json');

// Ensure browser data directory exists
if (!fs.existsSync(BROWSER_DATA_DIR)) {
  fs.mkdirSync(BROWSER_DATA_DIR, { recursive: true });
}

let browser = null;
let context = null;
let page = null;
let isLoggedIn = false;

/**
 * Get the current browser status
 */
export function getBrowserStatus() {
  return {
    isRunning: browser !== null && browser.isConnected(),
    isLoggedIn,
    hasStoredAuth: fs.existsSync(STORAGE_FILE)
  };
}

/**
 * Launch the browser and restore session if available
 */
export async function launchBrowser() {
  if (browser && browser.isConnected()) {
    return { success: true, message: 'Browser already running' };
  }

  try {
    browser = await chromium.launch({
      headless: false,  // Visible so user can intervene if needed
      args: [
        '--disable-blink-features=AutomationControlled',
        '--no-sandbox'
      ]
    });

    // Try to restore saved auth state
    const contextOptions = {
      viewport: { width: 1280, height: 800 },
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36'
    };

    if (fs.existsSync(STORAGE_FILE)) {
      contextOptions.storageState = STORAGE_FILE;
    }

    context = await browser.newContext(contextOptions);
    page = await context.newPage();

    // Check if we're logged in by navigating to X
    await page.goto('https://x.com/home', { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(3000);

    const currentUrl = page.url();
    isLoggedIn = !currentUrl.includes('login') && !currentUrl.includes('i/flow');

    if (isLoggedIn) {
      console.log('✅ Browser launched with saved session — logged in!');
    } else {
      console.log('⚠️  Browser launched but not logged in — use /api/automation/login');
    }

    return { success: true, isLoggedIn };
  } catch (error) {
    console.error('❌ Failed to launch browser:', error.message);
    return { success: false, error: error.message };
  }
}

/**
 * Login to X.com — navigates to login page and waits for user to manually login
 * (Safer than automating credentials)
 */
export async function loginToX() {
  if (!browser || !browser.isConnected()) {
    await launchBrowser();
  }

  try {
    await page.goto('https://x.com/i/flow/login', { waitUntil: 'domcontentloaded', timeout: 30000 });

    console.log('🔐 Please log in manually in the browser window...');
    console.log('   The system will detect when you\'re logged in.');

    // Wait for the user to complete login (max 5 minutes)
    // We detect login by waiting for the home timeline to appear
    await page.waitForURL('**/home', { timeout: 300000 });
    await page.waitForTimeout(3000);

    // Save auth state for future sessions
    await context.storageState({ path: STORAGE_FILE });
    isLoggedIn = true;

    console.log('✅ Login successful! Auth state saved.');
    return { success: true, message: 'Logged in successfully. Session saved.' };
  } catch (error) {
    console.error('❌ Login failed or timed out:', error.message);
    return { success: false, error: error.message };
  }
}

/**
 * Send a DM to a specific X user
 * @param {string} handle - X handle (without @)
 * @param {string} message - Message text to send
 * @param {boolean} dryRun - If true, simulate without sending
 */
export async function sendDM(handle, message, dryRun = true) {
  if (dryRun) {
    console.log(`📧 [DRY RUN] Would send DM to @${handle}:`);
    console.log(`   "${message.substring(0, 80)}..."`);
    return { success: true, dryRun: true, handle, message };
  }

  if (!isLoggedIn) {
    return { success: false, error: 'Not logged in. Call /api/automation/login first.' };
  }

  try {
    // Navigate to the user's DM conversation
    const cleanHandle = handle.replace('@', '').trim();

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
    const sendBtn = await page.waitForSelector('[data-testid="dmComposerSendButton"], [aria-label="Send"]', { timeout: 5000 });
    await sendBtn.click();
    await randomDelay(2000, 4000);

    console.log(`✅ DM sent to @${cleanHandle}`);
    return { success: true, handle: cleanHandle, message };

  } catch (error) {
    console.error(`❌ Failed to send DM to @${handle}:`, error.message);
    return { success: false, error: error.message, handle };
  }
}

/**
 * Check if a user has replied to our DMs
 * @param {string} handle - X handle to check
 */
export async function checkForReply(handle) {
  if (!isLoggedIn || !page) {
    return { hasReply: false, error: 'Not logged in' };
  }

  try {
    const cleanHandle = handle.replace('@', '').trim();
    await page.goto(`https://x.com/messages`, { waitUntil: 'domcontentloaded', timeout: 20000 });
    await randomDelay(2000, 4000);

    // Look for the conversation with this user
    // This is a basic check — looks for the user handle in the conversations list
    const conversations = await page.$$('[data-testid="conversation"]');

    for (const conv of conversations) {
      const text = await conv.textContent();
      if (text.toLowerCase().includes(cleanHandle.toLowerCase())) {
        // Check if the last message is from them (not from us)
        // This is a heuristic — the conversation shows the latest message
        return { hasReply: true, handle: cleanHandle };
      }
    }

    return { hasReply: false, handle: cleanHandle };
  } catch (error) {
    return { hasReply: false, error: error.message };
  }
}

/**
 * Scrape all DM conversation contacts from X.com
 * Navigates to messages page, scrolls to load conversations, extracts handles/names
 * @param {number} maxScroll - Max number of scroll attempts to load more conversations
 * @returns {{ success: boolean, contacts: Array<{handle: string, displayName: string}> }}
 */
export async function scrapeDMContacts(maxScroll = 15) {
  if (!isLoggedIn || !page) {
    return { success: false, error: 'Not logged in. Launch browser and login first.', contacts: [] };
  }

  try {
    console.log('📥 Scraping DM contacts from X.com...');

    // Navigate to messages
    await page.goto('https://x.com/messages', { waitUntil: 'domcontentloaded', timeout: 30000 });
    await randomDelay(3000, 5000);

    const contacts = new Map(); // handle -> { handle, displayName }

    // Scroll and collect contacts
    for (let scroll = 0; scroll < maxScroll; scroll++) {
      // Extract conversation entries from the current view
      const newContacts = await page.evaluate(() => {
        const results = [];

        // Strategy 1: Look for conversation list items with user info
        // X typically renders conversations in a scrollable list
        const convItems = document.querySelectorAll('[data-testid="conversation"], [data-testid="cellInnerDiv"]');

        for (const item of convItems) {
          // Try to find the username/handle in the conversation item
          // X shows @handle or the display name in conversation entries
          const allText = item.textContent || '';
          const links = item.querySelectorAll('a[href^="/"]');

          for (const link of links) {
            const href = link.getAttribute('href') || '';
            // Filter out non-profile links
            if (href && href.startsWith('/') && !href.includes('/messages') &&
                !href.includes('/i/') && !href.includes('/settings') &&
                !href.includes('/notifications') && !href.includes('/search') &&
                !href.includes('/home') && !href.includes('/explore') &&
                href.split('/').length === 2) {
              const handle = href.replace('/', '').trim();
              if (handle && handle.length > 0 && handle.length < 50) {
                // Try to get display name from nearby elements
                const nameEl = item.querySelector('span[style*="font-weight"]') ||
                               item.querySelector('[dir="ltr"] > span') ||
                               item.querySelector('span');
                const displayName = nameEl ? nameEl.textContent.trim() : '';
                results.push({ handle, displayName });
              }
            }
          }
        }

        // Strategy 2: Look for DM inbox items with specific structure
        const dmLinks = document.querySelectorAll('a[href*="/messages/"]');
        for (const link of dmLinks) {
          const parent = link.closest('[data-testid="cellInnerDiv"]') || link.parentElement;
          if (parent) {
            const spans = parent.querySelectorAll('span');
            for (const span of spans) {
              const text = span.textContent.trim();
              if (text.startsWith('@')) {
                const handle = text.replace('@', '').trim();
                results.push({ handle, displayName: '' });
              }
            }
          }
        }

        return results;
      });

      // Add to our map (deduplicating)
      for (const c of newContacts) {
        if (c.handle && !contacts.has(c.handle.toLowerCase())) {
          contacts.set(c.handle.toLowerCase(), {
            handle: c.handle,
            displayName: c.displayName || ''
          });
        }
      }

      console.log(`   Scroll ${scroll + 1}/${maxScroll}: Found ${contacts.size} unique contacts so far`);

      // Scroll down to load more conversations
      const scrollContainer = await page.$('[data-testid="DmScrollerContainer"]') ||
                               await page.$('section[role="region"]') ||
                               await page.$('div[data-testid="primaryColumn"]');

      if (scrollContainer) {
        await scrollContainer.evaluate(el => el.scrollTop += el.clientHeight);
      } else {
        await page.evaluate(() => window.scrollBy(0, 600));
      }

      await randomDelay(1500, 3000);

      // Check if we've reached the end (no new contacts after scroll)
      if (scroll > 3 && newContacts.length === 0) {
        console.log('   Reached end of conversations list');
        break;
      }
    }

    const contactList = Array.from(contacts.values());
    console.log(`✅ Scraped ${contactList.length} DM contacts`);

    return { success: true, contacts: contactList };
  } catch (error) {
    console.error('❌ Failed to scrape DM contacts:', error.message);
    return { success: false, error: error.message, contacts: [] };
  }
}

/**
 * Close the browser
 */
export async function closeBrowser() {
  if (context) {
    try {
      await context.storageState({ path: STORAGE_FILE });
    } catch (e) { /* ignore save errors on close */ }
  }
  if (browser) {
    await browser.close();
    browser = null;
    context = null;
    page = null;
    isLoggedIn = false;
  }
  return { success: true };
}

// ─── Helpers ──────────────────────────────────────────────────────────

/**
 * Type text in a human-like way with random delays between keystrokes
 */
async function typeHuman(element, text) {
  for (const char of text) {
    await element.type(char, { delay: 30 + Math.random() * 120 });
    // Occasionally pause longer (simulates thinking)
    if (Math.random() < 0.05) {
      await randomDelay(300, 800);
    }
  }
}

/**
 * Wait for a random duration between min and max milliseconds
 */
async function randomDelay(min, max) {
  const delay = Math.floor(Math.random() * (max - min) + min);
  await new Promise(resolve => setTimeout(resolve, delay));
}
