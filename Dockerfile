FROM node:22-alpine
WORKDIR /app
ENV SHARP_IGNORE_GLOBAL_LIBVIPS=1
RUN apk add --no-cache git
COPY scripts/write-build-revision.sh ./scripts/write-build-revision.sh
COPY .git ./.git
RUN sh scripts/write-build-revision.sh .release-revision && rm -rf .git
COPY package.json package-lock.json ./
RUN npm install --omit=dev --ignore-scripts
RUN npx esbuild --version || true
COPY dist/server ./server
COPY dist/client ./client
ENV NODE_ENV=production
ENV PORT=4321
ENV HOST=0.0.0.0
ENV APP_REVISION_FILE=/app/.release-revision
EXPOSE 4321
CMD ["node", "server/entry.mjs"]
