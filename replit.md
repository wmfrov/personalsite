# Workspace

## Overview

pnpm workspace monorepo using TypeScript. Each package manages its own dependencies.

## Stack

- **Monorepo tool**: pnpm workspaces
- **Node.js version**: 24
- **Package manager**: pnpm
- **TypeScript version**: 5.9
- **API framework**: Express 5
- **Database**: PostgreSQL + Drizzle ORM
- **Validation**: Zod (`zod/v4`), `drizzle-zod`
- **API codegen**: Orval (from OpenAPI spec)
- **Build**: esbuild (CJS bundle)

## Key Commands

- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- `pnpm --filter @workspace/api-server run dev` — run API server locally

See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details.

## Artifacts

- **brutalist-ai** (`artifacts/brutalist-ai/`) — React + Vite single-page brutalist "AI × PostHog" dashboard. Visuals derived deterministically from SHA-256(seed) via Mulberry32 PRNG. Centerpiece EMBEDDING SPACE with ~40 drifting dots + 4 supporting panels (WEIGHTS, TOKEN STREAM, LOSS, PROBABILITIES). Seed input commits on Enter / blur (typing alone never rehashes). Keyboard: `f` fullscreen, `h` hide chrome. Export modal supports LinkedIn (1584×396) / X (1500×500) / Custom banners via html-to-image; in export mode `→` and `←` give true bidirectional single-frame stepping (each panel snapshots state + Mulberry32 PRNG via getState/setState, so forward → back → forward is byte-identical), `↓` or the in-bar button downloads PNG. Seed permalink in `window.location.hash`. No backend, no DB.
  - `vite.config.ts` reads `PORT` and `BASE_PATH` from env (the artifact runtime injects them) but falls back to safe defaults (`5173` / `/`), so `pnpm --filter @workspace/brutalist-ai run build` and `dev` Just Work locally and in CI without manual env wiring.
