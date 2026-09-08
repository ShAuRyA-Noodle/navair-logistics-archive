import { assertSameOrigin, requireActor } from '@/lib/auth';
import { handle, json, readJson } from '@/lib/http';
import { importData } from '@/lib/data-import';

export async function POST(request: Request) {
  return handle(async () => {
    assertSameOrigin(request);
    return json(await importData((await requireActor(request)).id, await readJson(request, 1_000_000)), 201);
  });
}
