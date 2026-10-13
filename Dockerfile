FROM node:24-bookworm-slim AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build && npm run check

FROM node:24-bookworm-slim
ENV NODE_ENV=production PORT=5196
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY --from=build /app/backend ./backend
COPY --from=build /app/db ./db
COPY --from=build /app/scripts/preserve-env-acl.ps1 ./scripts/preserve-env-acl.ps1
USER node
EXPOSE 5196
CMD ["node", "backend/index.js"]
