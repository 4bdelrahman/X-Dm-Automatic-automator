const { google } = require('googleapis');

class GoogleSheetsManager {
  constructor() {
    this.sheets = null;
    this.spreadsheetId = process.env.GOOGLE_SHEET_ID;
  }

  async init() {
    try {
      // Parse the service account JSON from env var
      const serviceAccountJson = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_JSON);

      const auth = new google.auth.GoogleAuth({
        credentials: serviceAccountJson,
        scopes: ['https://www.googleapis.com/auth/spreadsheets'],
      });

      const authClient = await auth.getClient();
      this.sheets = google.sheets({ version: 'v4', auth: authClient });
      console.log('[Sheets] Google Sheets initialized successfully');
    } catch (error) {
      console.error('[Sheets] Failed to initialize:', error.message);
      throw error;
    }
  }

  // Get all leads from the sheet
  async getLeads(sheetName = 'Sheet1') {
    const response = await this.sheets.spreadsheets.values.get({
      spreadsheetId: this.spreadsheetId,
      range: `${sheetName}!A:Z`, // Get all columns
    });

    const rows = response.data.values;
    if (!rows || rows.length === 0) return [];

    const headers = rows[0]; // First row is headers
    const leads = rows.slice(1).map((row, index) => {
      const lead = { _rowIndex: index + 2 }; // +2 because row 1 is headers, sheets are 1-indexed
      headers.forEach((header, colIndex) => {
        lead[header.toLowerCase().replace(/\s+/g, '_')] = row[colIndex] || '';
      });
      return lead;
    });

    return leads;
  }

  // Mark a lead as DM sent in the sheet
  async markLeadStatus(rowIndex, status, columnLetter = 'Z') {
    try {
      await this.sheets.spreadsheets.values.update({
        spreadsheetId: this.spreadsheetId,
        range: `Sheet1!${columnLetter}${rowIndex}`,
        valueInputOption: 'RAW',
        requestBody: {
          values: [[status]],
        },
      });
    } catch (error) {
      console.error(`[Sheets] Failed to update row ${rowIndex}:`, error.message);
    }
  }

  // Get the index of the last processed row from the sheet
  async getLastProcessedRow() {
    try {
      const response = await this.sheets.spreadsheets.values.get({
        spreadsheetId: this.spreadsheetId,
        range: 'Sheet1!Z:Z', // Status column
      });
      const values = response.data.values || [];
      // Count rows that already have a status
      return values.length;
    } catch {
      return 1; // Start from beginning if error
    }
  }
}

module.exports = new GoogleSheetsManager();
