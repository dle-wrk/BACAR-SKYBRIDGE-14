FROM node:20-alpine AS build
WORKDIR /app

# Vite inlines VITE_* at build time, so they must be present during `npm run build`.
# These are public values that end up in the client bundle — never pass a secret here.
ARG VITE_BASE44_APP_ID
ARG VITE_BASE44_APP_BASE_URL
ENV VITE_BASE44_APP_ID=$VITE_BASE44_APP_ID
ENV VITE_BASE44_APP_BASE_URL=$VITE_BASE44_APP_BASE_URL

COPY package*.json ./
RUN npm ci

COPY . .
RUN npm run build

FROM pierrezemb/gostatic
COPY --from=build /app/dist /srv/http/
# -fallback sends unknown paths to index.html so react-router deep links
# (/cube/BACAR-14A) survive a refresh instead of 404ing.
CMD ["-port","8080","-https-promote","-enable-logging","-fallback","/index.html"]
