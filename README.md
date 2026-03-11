# Job Posting Dashboard

Next.js + SQLite dashboard for aggregating jobs from editable sources.

## What changed to fix empty results
This build now supports three ingest modes:
- `RSS` feed sync (when `feed_url` is a normal URL)
- `JSON API` sync (when `feed_url` starts with `json:`)
- `Website crawl` mode (when `feed_url` is empty) that crawls career page HTML links and sitemap URLs to discover job links

So sources like Apple/Google/Meta/NVIDIA/TikTok/etc. can still produce records via crawl mode even without RSS.

## Features
- Editable job sources
- Crawl + RSS + JSON ingestion
- Keyword filter
- Created date filter
- One-click apply links
- SQLite storage
- Per-source sync status with diagnostics

## How to run
```bash
git clone https://github.com/shaakib99/job-posting.git
cd job-posting
npm config set registry https://registry.npmjs.org/
npm install
npm run dev
```

Open `http://localhost:3000`, click **Sync Jobs**, then search by keyword/date.

## Feed URL behavior
- `https://...` => RSS parser
- `json:https://...` => JSON API parser
- empty => website crawler (HTML + sitemap)
