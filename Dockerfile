# Single-image WhatsApp MCP+ server.
# Build:  docker build -t whatsapp-mcp-plus .
# Run:    docker run -it -v wamcp-data:/app/data -v wamcp-auth:/app/auth_info whatsapp-mcp-plus
# The first run prints a QR in the terminal; scan it with WhatsApp > Linked Devices.
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm install
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
ENV WAMCP_MODE=read-only
ENV WAMCP_DATA_DIR=/app/data
ENV WAMCP_AUTH_DIR=/app/auth_info
COPY package.json package-lock.json* ./
RUN npm install --omit=dev
COPY --from=build /app/dist ./dist
VOLUME ["/app/data", "/app/auth_info"]
ENTRYPOINT ["node", "dist/index.js"]
