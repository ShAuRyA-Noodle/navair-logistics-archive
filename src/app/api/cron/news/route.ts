import {assertCronCaller} from '@/lib/cron';
import {pool} from '@/lib/db';
import {handle,json} from '@/lib/http';
import {runSweep} from '@/lib/news/sweep';

// A serverless function has a wall clock, so each run fetches everything but analyses only
// a small batch and leaves the rest for the next firing. Already-analysed pairs are skipped,
// so the backlog drains across runs instead of one run timing out.
export const maxDuration = 300;

export async function GET(request:Request){return handle(async()=>{
 assertCronCaller(request);
 const result=await runSweep({
  pool,
  maxAnalyses:Number(process.env.NEWS_MAX_ANALYSES ?? 6),
  minImportance:Number(process.env.NEWS_MIN_IMPORTANCE ?? 5),
  budgetMs:Number(process.env.NEWS_BUDGET_MS ?? 240_000),
 });
 return json({ok:true,...result});
});}
