# Lotto Random

Lotto Random is a Thai lottery companion web application for generating number ideas, interpreting dreams and everyday stories, checking tickets against lottery results, and exploring historical statistics.

The application is designed for entertainment and decision support. It does not predict or guarantee lottery results.

## Features

- Quick Pick for 2-digit, 3-digit, and 6-digit number sets
- Configurable random generation with weighted hot, cold, and balanced modes
- Dream-to-number interpretation using configurable dream rules
- Story and symbol-to-number interpretation using configurable symbol rules
- Explainable results with highlighted numbers and reasons
- Save generated slips locally and share slip text
- Prize checker for six-digit tickets, including:
  - First prize
  - Adjacent first-prize numbers
  - Second through fifth prizes
  - Front three, back three, and last two numbers
- Historical statistics for recent draws, including frequent and overdue numbers
- Lottery result history loaded from the backend proxy
- Persistent browser and server-side caching to reduce external API requests
- Retry, rate-limit handling, stale-cache fallback, and partial-result handling
- Manual result overrides for configured draws when an external source needs correction or supplementation
- Responsive Thai-language UI with mobile-first layouts and accessible controls

## Tech stack

- React 19
- Vite 7
- JavaScript with ES modules
- Tailwind CSS 4 through `@tailwindcss/vite`
- Node.js HTTP server for the API proxy and production static hosting
- ESLint 9
- `framer-motion`, `lucide-react`, and `canvas-confetti`

## Requirements

- Node.js 20 or later is recommended
- npm
- Network access for fresh lottery results from the external API

## Getting started

Install dependencies:

```bash
npm ci
```

Start the development environment:

```bash
npm run dev
```

The development command starts the Node API server and the Vite development server. Open the URL shown by Vite, usually [http://localhost:5173](http://localhost:5173).

## Available scripts

```bash
# Start the API server and Vite development server
npm run dev

# Start only the Vite client
npm run dev:client

# Start only the Node API/static server
npm run api

# Create a production client build
npm run build

# Serve the production build through the Node server
npm run start

# Preview the Vite build
npm run preview

# Run ESLint
npm run lint
```

## API endpoints

The Node server provides a small proxy layer for lottery data:

| Endpoint | Description |
| --- | --- |
| `GET /api/health` | Returns the proxy health status |
| `GET /api/lottery-results` | Returns the latest lottery results; accepts an optional `limit` query parameter |

Example:

```text
GET /api/lottery-results?limit=8
```

The API response normalizes the external result format into the structure consumed by the client and includes cache/source metadata.

## Configuration

The server supports the following environment variables:

| Variable | Default | Description |
| --- | --- | --- |
| `PORT` | `4173` | Port used by the Node server |
| `LOTTERY_CACHE_TTL_MS` | `600000` | Cache lifetime in milliseconds; defaults to 10 minutes |
| `LOTTERY_CACHE_FILE` | `.cache/lottery-results.json` | Path for persistent lottery-result cache |

Example:

```bash
LOTTERY_CACHE_TTL_MS=300000 npm run start
```

## Data sources and reliability

Fresh draw data is fetched through the Rayriffy Thai Lottery API configured in `server/config.js`. The proxy fetches list and detail endpoints, normalizes prize data, retries failed detail requests, and limits concurrent requests.

The application also supports configured manual overrides in `server/data/manualOverrides.json`. An override can use seeded data or fetch a configured source page when available. This is intended as a controlled fallback for draw data that is missing, incomplete, or needs verification.

Because lottery data depends on external services, the application may show cached or partial results when the upstream API is unavailable or rate-limited. Always verify official results before treating a result as final.

## Local storage

The client stores user-specific, non-account data in browser `localStorage`, including:

- Saved slips
- Recent generations
- UI preferences
- A client-side lottery result cache

Clearing browser storage removes saved slips and local preferences for that browser.

## Project structure

```text
.
├─ src/
│  ├─ App.jsx                 # Main application UI and feature orchestration
│  ├─ index.css               # Global design system and responsive styles
│  ├─ lib/
│  │  ├─ lotteryEngine.js     # Number generation and text interpretation logic
│  │  └─ storage.js           # Browser storage helpers
│  └─ data/
│     ├─ dream-rules.json     # Dream interpretation rules
│     └─ symbol-rules.json    # Story/symbol interpretation rules
├─ server/
│  ├─ index.js                # Production server entry point
│  ├─ dev.js                  # Development process runner
│  ├─ routes.js               # API and static-file routes
│  ├─ config.js               # Server and upstream API configuration
│  ├─ services/
│  │  ├─ rayriffyClient.js    # External API client and retries
│  │  ├─ lotteryNormalizer.js # External response normalization
│  │  ├─ lotteryCache.js      # Memory and persistent cache
│  │  ├─ lotteryService.js    # Result service orchestration
│  │  └─ manualOverrideService.js
│  └─ data/manualOverrides.json
├─ docs/
│  └─ thai-lotto-product-plan.md
├─ public/
├─ vite.config.js
├─ eslint.config.js
└─ package.json
```

## Data and rule updates

To add or adjust dream or symbol interpretations, update the corresponding JSON file in `src/data/`. Each rule can provide tags, primary numbers, secondary numbers, and explanatory notes used to build a generated slip.

To add a controlled lottery-result override, update `server/data/manualOverrides.json` with the draw date, source, and prize data. Verify the source and draw date carefully before committing changes.

## Data scope and limitations

- Generated numbers are random or rule-based suggestions for entertainment; they are not forecasts and do not improve the mathematical odds of winning.
- Historical frequency and overdue-number views describe past results only. They must not be presented as evidence that a number is more likely to appear in a future draw.
- Fresh results depend on the external Rayriffy API and, for configured overrides, the referenced source page. Availability, format, rate limits, and update timing may change.
- Cached or manual data can be older than the official announcement. Verify results with the Government Lottery Office or another official channel.
- The dream and symbol rules are a curated interpretation dataset, not a factual or scientific model.
- The project does not provide user accounts, cross-device synchronization, payment features, or guaranteed notifications in the current version.

## Pre-PR checks

```bash
npm ci
npm run lint
npm run build
git status
```

The current branch has been checked successfully with `npm run lint` and `npm run build`.

## Project status

- Current branch: `main`
- Branch is ahead of `origin/main` by 13 commits at the time of documentation
- Remote: `https://github.com/inakirup/HuayToday.git`
