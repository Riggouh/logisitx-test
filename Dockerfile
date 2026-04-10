FROM node:18-alpine
WORKDIR /app

# Install dependencies (esbuild + lit-html)
COPY package*.json ./
RUN npm install

# Copy source and build
COPY src/ src/
COPY build.mjs .
RUN node build.mjs

# Runtime: only server + built assets
FROM node:18-alpine
WORKDIR /app
COPY --from=0 /app/public ./public
COPY server.js .
EXPOSE 3914
CMD ["node","server.js"]
