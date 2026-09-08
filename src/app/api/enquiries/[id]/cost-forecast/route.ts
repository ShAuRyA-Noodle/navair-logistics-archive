import { requireActor } from '@/lib/auth';
import { handle, json } from '@/lib/http';
import { getInternalCostForecast } from '@/lib/data-import';

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  return handle(async () => json(await getInternalCostForecast((await requireActor(request)).id, (await context.params).id, new URL(request.url).searchParams)));
}
