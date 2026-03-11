import Parser from 'rss-parser';
import db from './db';

type Source = {
  id: number;
  name: string;
  source_url: string;
  feed_url: string | null;
};

type SyncDetail = {
  source: string;
  inserted: number;
  status: 'ok' | 'skipped' | 'error';
  message?: string;
};

type JobRecord = {
  title: string;
  company: string | null;
  location: string | null;
  apply_url: string;
  posted_at: string | null;
  external_id: string | null;
  raw_json: string;
};

const parser = new Parser();
const JOB_HINT = /(job|career|position|opening|vacanc|requisition|opportunit|role|apply|workday|greenhouse|lever)/i;

function normalizeDate(value?: string | null) {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

function stripHtml(value: string) {
  return value.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
}

function absoluteUrl(baseUrl: string, maybeUrl: string) {
  try {
    return new URL(maybeUrl, baseUrl).toString();
  } catch {
    return null;
  }
}

function uniqueByApplyUrl(records: JobRecord[]) {
  const map = new Map<string, JobRecord>();
  for (const record of records) {
    if (!record.apply_url) continue;
    if (!map.has(record.apply_url)) map.set(record.apply_url, record);
  }
  return Array.from(map.values());
}

async function fetchText(url: string, accept = 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8') {
  const response = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (compatible; job-posting-dashboard/1.0)',
      Accept: accept
    },
    cache: 'no-store'
  });

  if (!response.ok) throw new Error(`HTTP ${response.status} for ${url}`);
  return response.text();
}

async function fetchJson(url: string, init?: RequestInit) {
  const response = await fetch(url, {
    ...init,
    headers: {
      'User-Agent': 'Mozilla/5.0 (compatible; job-posting-dashboard/1.0)',
      Accept: 'application/json',
      ...(init?.headers ?? {})
    },
    cache: 'no-store'
  });

  if (!response.ok) throw new Error(`HTTP ${response.status} for ${url}`);
  return response.json();
}

async function syncWorkdaySource(source: Source): Promise<JobRecord[]> {
  const url = new URL(source.source_url);
  if (!url.hostname.includes('myworkdayjobs.com')) return [];

  const pathParts = url.pathname.split('/').filter(Boolean);
  if (pathParts.length < 1) return [];
  const site = pathParts[0];
  const tenant = url.hostname.split('.')[0];
  const apiUrl = `https://${url.hostname}/wday/cxs/${tenant}/${site}/jobs`;

  const payload = (await fetchJson(apiUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ limit: 100, offset: 0, searchText: '' })
  })) as { jobPostings?: any[] };

  const postings = Array.isArray(payload.jobPostings) ? payload.jobPostings : [];

  return postings.map((item) => {
    const externalPath = item.externalPath ?? item.bulletFields?.[0] ?? '';
    const apply = absoluteUrl(source.source_url, externalPath) ?? source.source_url;

    return {
      title: item.title ?? 'Untitled role',
      company: source.name,
      location: item.locationsText ?? null,
      apply_url: apply,
      posted_at: normalizeDate(item.postedOn),
      external_id: String(item.bulletFields?.join('-') ?? item.title ?? apply),
      raw_json: JSON.stringify({ discovered_from: 'workday', item })
    };
  });
}

async function syncGreenhouseSource(source: Source): Promise<JobRecord[]> {
  const match = source.source_url.match(/boards\.greenhouse\.io\/([^/?#]+)/i);
  if (!match) return [];
  const board = match[1];
  const apiUrl = `https://boards-api.greenhouse.io/v1/boards/${board}/jobs`;

  const payload = (await fetchJson(apiUrl)) as { jobs?: any[] };
  const jobs = Array.isArray(payload.jobs) ? payload.jobs : [];

  return jobs.map((item) => ({
    title: item.title ?? 'Untitled role',
    company: source.name,
    location: item.location?.name ?? null,
    apply_url: item.absolute_url ?? source.source_url,
    posted_at: normalizeDate(item.updated_at ?? item.first_published),
    external_id: String(item.id ?? item.absolute_url ?? Math.random()),
    raw_json: JSON.stringify({ discovered_from: 'greenhouse', item })
  }));
}

async function syncLeverSource(source: Source): Promise<JobRecord[]> {
  const match = source.source_url.match(/jobs\.lever\.co\/([^/?#]+)/i);
  if (!match) return [];
  const company = match[1];
  const apiUrl = `https://api.lever.co/v0/postings/${company}?mode=json`;

  const payload = (await fetchJson(apiUrl)) as any[];
  const jobs = Array.isArray(payload) ? payload : [];

  return jobs.map((item) => ({
    title: item.text ?? 'Untitled role',
    company: source.name,
    location: item.categories?.location ?? null,
    apply_url: item.hostedUrl ?? source.source_url,
    posted_at: normalizeDate(item.createdAt ? new Date(item.createdAt).toISOString() : null),
    external_id: String(item.id ?? item.hostedUrl ?? Math.random()),
    raw_json: JSON.stringify({ discovered_from: 'lever', item })
  }));
}

async function syncAtsSource(source: Source): Promise<JobRecord[]> {
  if (source.source_url.includes('myworkdayjobs.com')) return syncWorkdaySource(source);
  if (source.source_url.includes('greenhouse.io')) return syncGreenhouseSource(source);
  if (source.source_url.includes('jobs.lever.co')) return syncLeverSource(source);
  return [];
}

function extractJsonLdJobs(html: string, source: Source): JobRecord[] {
  const scripts = Array.from(
    html.matchAll(/<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)
  ).map((m) => m[1]);

  const records: JobRecord[] = [];
  for (const scriptContent of scripts) {
    try {
      const parsed = JSON.parse(scriptContent.trim());
      const nodes = Array.isArray(parsed) ? parsed : [parsed];

      for (const node of nodes) {
        if (node?.['@type'] !== 'JobPosting') continue;
        const applyUrl = node.url ? absoluteUrl(source.source_url, node.url) : source.source_url;
        if (!applyUrl) continue;

        records.push({
          title: node.title ?? 'Job Opening',
          company: node.hiringOrganization?.name ?? source.name,
          location:
            node.jobLocation?.address?.addressLocality ??
            node.jobLocation?.address?.addressRegion ??
            node.jobLocation?.address?.addressCountry ??
            null,
          apply_url: applyUrl,
          posted_at: normalizeDate(node.datePosted ?? node.validFrom),
          external_id: String(node.identifier?.value ?? applyUrl),
          raw_json: JSON.stringify({ discovered_from: 'jsonld', node })
        });
      }
    } catch {
      // ignore invalid JSON-LD
    }
  }

  return records;
}

function parseAnchors(html: string, baseUrl: string) {
  const links: Array<{ href: string; text: string }> = [];
  const anchorRegex = /<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;

  for (const match of html.matchAll(anchorRegex)) {
    const rawHref = match[1]?.trim();
    const text = stripHtml(match[2] ?? '');
    if (!rawHref) continue;
    const href = absoluteUrl(baseUrl, rawHref);
    if (!href) continue;
    links.push({ href, text });
  }

  return links;
}

function parseLooseUrls(html: string, baseUrl: string) {
  const found = new Set<string>();

  for (const match of html.matchAll(/https?:\/\/[^"'\s<>()]+/gi)) {
    if (JOB_HINT.test(match[0])) found.add(match[0]);
  }

  for (const match of html.matchAll(/"(\/[^"]*(job|career|position|opening)[^"]*)"/gi)) {
    const url = absoluteUrl(baseUrl, match[1]);
    if (url) found.add(url);
  }

  return Array.from(found);
}

function asJobRecord(source: Source, url: string, title?: string): JobRecord {
  const cleanTitle =
    title?.trim() || decodeURIComponent(url.split('/').pop() ?? 'Job Opening').replace(/[-_]/g, ' ').trim() || 'Job Opening';

  return {
    title: cleanTitle,
    company: source.name,
    location: null,
    apply_url: url,
    posted_at: null,
    external_id: url,
    raw_json: JSON.stringify({ discovered_from: 'crawl', url, title: cleanTitle })
  };
}

async function crawlSitemap(source: Source): Promise<JobRecord[]> {
  const root = new URL(source.source_url).origin;
  const sitemapCandidates = [`${root}/sitemap.xml`, `${root}/sitemap_index.xml`, `${root}/sitemap-index.xml`, `${root}/sitemaps.xml`];

  for (const sitemapUrl of sitemapCandidates) {
    try {
      const xml = await fetchText(sitemapUrl, 'application/xml,text/xml;q=0.9,*/*;q=0.8');
      const locMatches = Array.from(xml.matchAll(/<loc>([^<]+)<\/loc>/gi)).map((m) => m[1]).slice(0, 2000);
      const filtered = locMatches.filter((loc) => JOB_HINT.test(loc));
      if (filtered.length === 0) continue;
      return filtered.slice(0, 120).map((url) => asJobRecord(source, url));
    } catch {
      // try next sitemap
    }
  }

  return [];
}

async function crawlHtmlSource(source: Source): Promise<JobRecord[]> {
  const root = new URL(source.source_url).origin;
  const entryPoints = [source.source_url, `${root}/careers`, `${root}/career`, `${root}/jobs`, `${root}/job`, `${root}/join-us`];

  const collected: JobRecord[] = [];
  for (const entry of entryPoints) {
    try {
      const html = await fetchText(entry);
      collected.push(...extractJsonLdJobs(html, source));
      collected.push(
        ...parseAnchors(html, entry)
          .filter((link) => JOB_HINT.test(link.href) || JOB_HINT.test(link.text))
          .slice(0, 200)
          .map((link) => asJobRecord(source, link.href, link.text))
      );
      collected.push(...parseLooseUrls(html, entry).slice(0, 200).map((url) => asJobRecord(source, url)));
    } catch {
      // continue
    }
  }

  const unique = uniqueByApplyUrl(collected).slice(0, 150);
  if (unique.length > 0) return unique;
  return crawlSitemap(source);
}

async function syncRssSource(source: Source): Promise<JobRecord[]> {
  const feed = await parser.parseURL(source.feed_url as string);
  return feed.items.slice(0, 100).map((item) => ({
    title: item.title ?? 'Untitled role',
    company: feed.title ?? source.name,
    location: (item as Record<string, string>).location ?? null,
    apply_url: item.link ?? source.source_url,
    posted_at: normalizeDate(item.pubDate),
    external_id: item.guid ?? item.link ?? null,
    raw_json: JSON.stringify(item)
  }));
}

async function syncJsonSource(source: Source): Promise<JobRecord[]> {
  const endpoint = (source.feed_url as string).replace(/^json:/, '');
  const payload = (await fetchJson(endpoint)) as { data?: any[]; jobs?: any[]; results?: any[]; postings?: any[] };
  const jobs = payload.data ?? payload.jobs ?? payload.results ?? payload.postings ?? [];
  if (!Array.isArray(jobs)) return [];

  return jobs.slice(0, 200).map((item) => ({
    title: item.title ?? item.position ?? item.name ?? 'Untitled role',
    company: item.company_name ?? item.company ?? source.name,
    location: Array.isArray(item.location) ? item.location.join(', ') : item.location ?? null,
    apply_url: item.url ?? item.apply_url ?? item.absolute_url ?? source.source_url,
    posted_at: normalizeDate(item.created_at ?? item.published_at ?? item.date),
    external_id: String(item.slug ?? item.id ?? item.url ?? item.apply_url ?? Math.random()),
    raw_json: JSON.stringify(item)
  }));
}

export async function fetchAndStoreJobs() {
  const sources = db.prepare('SELECT id, name, source_url, feed_url FROM sources WHERE enabled = 1').all() as Source[];
  const insertJob = db.prepare(`
    INSERT OR IGNORE INTO jobs (source_id, title, company, location, apply_url, posted_at, external_id, raw_json)
    VALUES (@source_id, @title, @company, @location, @apply_url, @posted_at, @external_id, @raw_json)
  `);

  let inserted = 0;
  const details: SyncDetail[] = [];

  for (const source of sources) {
    try {
      let records: JobRecord[] = [];

      if (source.feed_url?.startsWith('json:')) {
        records = await syncJsonSource(source);
      } else if (source.feed_url) {
        records = await syncRssSource(source);
      } else {
        const atsRecords = await syncAtsSource(source);
        records = atsRecords.length > 0 ? atsRecords : await crawlHtmlSource(source);
      }

      const deduped = uniqueByApplyUrl(records).filter((record) => Boolean(record.apply_url));

      let sourceInserted = 0;
      for (const record of deduped) {
        const result = insertJob.run({ source_id: source.id, ...record });
        sourceInserted += result.changes;
      }

      inserted += sourceInserted;
      details.push({
        source: source.name,
        inserted: sourceInserted,
        status: deduped.length > 0 ? 'ok' : 'skipped',
        message: `${deduped.length} discovered`
      });
    } catch (error) {
      details.push({
        source: source.name,
        inserted: 0,
        status: 'error',
        message: error instanceof Error ? error.message : 'Unknown sync error'
      });
    }
  }

  return { inserted, scannedSources: sources.length, details };
}
