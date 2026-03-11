import { NextRequest, NextResponse } from 'next/server';
import db from '@/lib/db';

export async function GET() {
  const sources = db.prepare('SELECT * FROM sources ORDER BY id DESC').all();
  return NextResponse.json(sources);
}

export async function POST(request: NextRequest) {
  const body = await request.json();
  const { name, source_url, feed_url, enabled } = body;

  if (!name || !source_url) {
    return NextResponse.json({ error: 'name and source_url are required' }, { status: 400 });
  }

  const result = db
    .prepare('INSERT INTO sources (name, source_url, feed_url, enabled) VALUES (?, ?, ?, ?)')
    .run(name, source_url, feed_url || null, enabled ? 1 : 0);

  return NextResponse.json({ id: result.lastInsertRowid });
}
