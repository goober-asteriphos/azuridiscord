# Use official lightweight Node.js 22 LTS on Alpine Linux
FROM node:22-alpine

# Install FFmpeg for stream audio processing
RUN apk add --no-cache ffmpeg

# Set working directory
WORKDIR /app

# Point FFMPEG_PATH to the system-installed ffmpeg binary
ENV FFMPEG_PATH=/usr/bin/ffmpeg
ENV NODE_ENV=production

# Copy package descriptors first to take advantage of Docker layer caching
COPY package*.json ./

# Install only production dependencies
RUN npm ci --omit=dev

# Copy the rest of the application source code
COPY . .

# Run slash command registration on container launch, then start the bot
CMD ["sh", "-c", "npm run register && npm start"]
