FROM node:20-alpine AS build
WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY . .
RUN npm run build

FROM pierrezemb/gostatic
COPY --from=build /app/dist /srv/http/
# -fallback sends unknown paths to index.html so react-router deep links
# (/cube/BACAR-14A) survive a refresh instead of 404ing.
CMD ["-port","8080","-https-promote","-enable-logging","-fallback","/index.html"]
