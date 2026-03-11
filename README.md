# Job Posting Dashboard

Next.js + SQLite dashboard for aggregating jobs from editable sources.

## Why jobs could be empty before
Some career pages are fully JS-rendered and do not expose RSS. If sync only relied on feeds/basic links, it returned no rows.

## What this version does
Sync now supports:
- RSS ingestion (`feed_url` = normal URL)
- JSON API ingestion (`feed_url` = `json:https://...`)
- Website crawling when `feed_url` is empty:
  - crawl source page + common career paths (`/careers`, `/jobs`, etc.)
  - extract links from anchors and embedded script URLs
  - parse `application/ld+json` JobPosting data
  - fallback to sitemap discovery (`/sitemap.xml`, `/sitemap_index.xml`)

## Features
- Editable sources
- Sync diagnostics by source
- Keyword filter
- Created date filter
- One-click apply links
- SQLite storage

## Run
```bash
git clone https://github.com/shaakib99/job-posting.git
cd job-posting
npm config set registry https://registry.npmjs.org/
npm install
npm run dev
```

Open `http://localhost:3000`, click **Sync Jobs**, then search by keyword/date.

## Feed URL rules
- `https://...` => RSS parser
- `json:https://...` => JSON parser
- empty => crawler mode


## Why crawling looked broken
Many large career pages (Workday/Greenhouse/Lever and custom JS apps) do not render job links in raw HTML response.
This project now tries ATS APIs first for known providers, then falls back to HTML/sitemap crawling.
