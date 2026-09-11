import { AppError } from './errors';

// Vercel Cron signs its calls with CRON_SECRET. Without this check the endpoints that
// spend money on model calls and send email would be open to anyone who guesses the path.
export function assertCronCaller(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) throw new AppError(503, 'CRON_NOT_CONFIGURED', 'CRON_SECRET is not set, so scheduled work is disabled.');
  const header = request.headers.get('authorization');
  if (header !== `Bearer ${secret}`) throw new AppError(401, 'UNAUTHORISED_CRON', 'This endpoint is only callable by the scheduler.');
}
