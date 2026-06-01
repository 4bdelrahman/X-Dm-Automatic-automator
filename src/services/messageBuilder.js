/**
 * Message Template Builder
 * Handles variable substitution in message templates
 */

/**
 * Parse a template string and replace variables with values
 * @param {string} template - Template string with {variable} placeholders
 * @param {object} variables - Key-value pairs for substitution
 * @returns {string} Processed message
 */
export function buildMessage(template, variables = {}) {
  let message = template;

  // Replace all {variable} placeholders
  for (const [key, value] of Object.entries(variables)) {
    const cleanKey = key.replace(/[{}]/g, '');
    const regex = new RegExp(`\\{${cleanKey}\\}`, 'gi');
    message = message.replace(regex, value || '');
  }

  // Remove any unreplaced variables (clean up)
  message = message.replace(/\{[a-zA-Z]+\}/g, '');

  // Clean up double spaces and trim
  message = message.replace(/  +/g, ' ').trim();

  // Add slight variations to make messages feel unique
  message = addHumanTouch(message);

  return message;
}

/**
 * Extract variable names from a template string
 * @param {string} template - Template string
 * @returns {string[]} Array of variable names
 */
export function extractVariables(template) {
  const matches = template.match(/\{([a-zA-Z]+)\}/g) || [];
  return [...new Set(matches)];
}

/**
 * Add subtle human-like variations to a message
 * Makes each message feel slightly unique even with the same template
 */
function addHumanTouch(message) {
  // Randomly vary greeting emojis
  const greetingEmojis = ['👋', '✋', '🙌', '🤙', '👊', '😊'];
  const closingEmojis = ['🚀', '💪', '✨', '🔥', '👏', '😊', '🙏'];

  // Randomly swap emojis (30% chance)
  if (Math.random() < 0.3) {
    message = message.replace('👋', greetingEmojis[Math.floor(Math.random() * greetingEmojis.length)]);
  }
  if (Math.random() < 0.3) {
    message = message.replace('🚀', closingEmojis[Math.floor(Math.random() * closingEmojis.length)]);
  }

  // Randomly add/remove a period (10% chance)
  if (Math.random() < 0.1 && message.endsWith('.')) {
    message = message.slice(0, -1);
  }

  return message;
}

/**
 * Validate a template has proper syntax
 * @param {string} template - Template to validate
 * @returns {{ valid: boolean, errors: string[] }}
 */
export function validateTemplate(template) {
  const errors = [];

  if (!template || template.trim().length === 0) {
    errors.push('Template cannot be empty');
  }

  if (template.length > 10000) {
    errors.push('Template is too long (max 10,000 characters)');
  }

  // Check for unclosed brackets
  const openBrackets = (template.match(/\{/g) || []).length;
  const closeBrackets = (template.match(/\}/g) || []).length;
  if (openBrackets !== closeBrackets) {
    errors.push('Template has mismatched brackets');
  }

  return { valid: errors.length === 0, errors };
}
