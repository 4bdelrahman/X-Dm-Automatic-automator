# Use the official Playwright image which has all Chrome dependencies
FROM mcr.microsoft.com/playwright:v1.40.0-jammy

# Set working directory
WORKDIR /app

# Copy package files first (for Docker layer caching)
COPY package*.json ./

# Install Node dependencies
RUN npm ci --only=production

# Copy source code
COPY src/ ./src/

# Install Playwright browsers (Chromium only to save space)
RUN npx playwright install chromium

# Expose the port (Railway sets PORT automatically)
EXPOSE $PORT

# Start the server
CMD ["node", "src/index.js"]
