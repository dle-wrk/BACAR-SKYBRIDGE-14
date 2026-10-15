FROM node:20-alpine AS build
WORKDIR /app

COPY package*.json ./
# --legacy-peer-deps because react-leaflet 5 declares react@^19 as a peer
# but the app runs on react@18. The runtime API we use (MapContainer,
# Marker, TileLayer, Polyline, Popup) is identical between the two.
RUN npm ci --legacy-peer-deps

COPY . .
RUN npm run build

FROM pierrezemb/gostatic
COPY --from=build /app/dist /srv/http/
# -fallback sends unknown paths to index.html so react-router deep links
# (/cube/BACAR-14A) survive a refresh instead of 404ing.
CMD ["-port","8080","-https-promote","-enable-logging","-fallback","/index.html"]
