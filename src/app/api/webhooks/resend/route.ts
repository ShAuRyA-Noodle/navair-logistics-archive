import { handle,json,readText } from '@/lib/http';
import { handleMailWebhook } from '@/lib/mail';
export async function POST(request:Request){return handle(async()=>{
 const raw=await readText(request,65536);
 const headers={id:request.headers.get('svix-id')??'',timestamp:request.headers.get('svix-timestamp')??'',signature:request.headers.get('svix-signature')??''};
 return json(await handleMailWebhook(raw,headers));
});}
