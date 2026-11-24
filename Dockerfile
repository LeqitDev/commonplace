# Build: everything (incl. server deps) is bundled into build/, so the runtime image needs no node_modules.
FROM oven/bun:1 AS build
WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile
COPY . .
# Optional modules in the image: all, or a comma list of calendar, tasks, mail, triage, notes, cards,
# canvas, pomodoro (src/modules/registry.ts; triage needs mail, cards and canvas need notes).
ARG MODULES=all
ENV MODULES=$MODULES
# Excalidraw's fonts (copied by postinstall) only serve the canvas
RUN case ",$MODULES," in *,all,*|*,canvas,*) ;; *) rm -rf static/fonts ;; esac
RUN bun run build

FROM oven/bun:1-slim
WORKDIR /app
# CONNECTION_IDLE_TIMEOUT: Bun drops a response that takes longer than this (default 10 s, max 255), e.g. a slow sync.
ENV NODE_ENV=production DATA_DIR=/data PORT=3000 BODY_SIZE_LIMIT=100M CONNECTION_IDLE_TIMEOUT=255
COPY --from=build /app/build ./build
RUN mkdir -p /data && chown bun:bun /data
USER bun
VOLUME /data
EXPOSE 3000
HEALTHCHECK --interval=1m CMD bun -e "fetch('http://localhost:3000/api/settings',{headers:{'remote-user':'healthcheck'}}).then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"
CMD ["bun", "build/index.js"]
