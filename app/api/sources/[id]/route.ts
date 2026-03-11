import { NextRequest, NextResponse } from 'next/server';
import db from '@/lib/db';

export async function PATCH(request: NextRequest, { params }: { params: { id: string } }) {
  const body = await request.json();
  const existing = db.prepare('SELECT * FROM sources WHERE id = ?').get(params.id);

  if (!existing) {
    return NextResponse.json({ error: 'Source not found' }, { status: 404 });
  }

  const name = body.name ?? (existing as any).name;
  const source_url = body.source_url ?? (existing as any).source_url;
  const feed_url = body.feed_url ?? (existing as any).feed_url;
  const enabled = typeof body.enabled === 'boolean' ? (body.enabled ? 1 : 0) : (existing as any).enabled;

  db.prepare('UPDATE sources SET name = ?, source_url = ?, feed_url = ?, enabled = ? WHERE id = ?').run(
    name,
    source_url,
    feed_url,
    enabled,
    params.id
  );

  return NextResponse.json({ ok: true });
}

export async function DELETE(_: NextRequest, { params }: { params: { id: string } }) {
  db.prepare('DELETE FROM sources WHERE id = ?').run(params.id);
  return NextResponse.json({ ok: true });
}
