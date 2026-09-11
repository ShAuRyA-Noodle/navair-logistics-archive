import {assertCronCaller} from '@/lib/cron';
import {pool} from '@/lib/db';
import {handle,json} from '@/lib/http';
import {processOutbox} from '@/lib/mail';
import {AppError} from '@/lib/errors';

// The mail worker is a long-lived loop locally; on Vercel the same queue is drained by the
// scheduler instead. Several passes per firing, because claim_email_outbox takes one job.
export const maxDuration = 60;

export async function GET(request:Request){return handle(async()=>{
 assertCronCaller(request);
 const actorId=process.env.WORKER_ACTOR_ID;
 if(!actorId)throw new AppError(503,'MAIL_WORKER_CONFIG','WORKER_ACTOR_ID is required to drain the mail queue.');
 const totals={processed:0,preview:0,sent:0,failed:0};
 for(let pass=0;pass<10;pass+=1){
  const result=await processOutbox(actorId);
  totals.processed+=result.processed;totals.preview+=result.preview;
  totals.sent+=result.sent;totals.failed+=result.failed;
  if(result.processed===0)break;
 }
 return json({ok:true,...totals});
});}
