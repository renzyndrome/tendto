# TendTo web — Vite build → static files behind nginx.
# VITE_* values are baked into the bundle at BUILD time; pass them as build args.
FROM node:22-alpine AS build

WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm install
COPY . .

ARG VITE_API_URL
ARG VITE_POWERSYNC_URL
ARG VITE_AUTH_URL
ENV VITE_API_URL=$VITE_API_URL \
    VITE_POWERSYNC_URL=$VITE_POWERSYNC_URL \
    VITE_AUTH_URL=$VITE_AUTH_URL
RUN npm run build

FROM nginx:1.27-alpine
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 80
