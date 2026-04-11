# Simple: use pre-built assets directly (no src/ needed)
FROM node:18-alpine
WORKDIR /app
COPY server.js .
COPY public/ ./public/
EXPOSE 47291
CMD ["node","server.js"]
