import { randomUUID } from 'node:crypto';
import { ZodError } from 'zod';
import { AppError } from './errors';
export function json(data:unknown,status=200,headers:Record<string,string>={}) {
  return Response.json(data,{status,headers:{'Cache-Control':'no-store',...headers}});
}
export async function readJson(request:Request,maxBytes=16000):Promise<unknown> {
  if(!request.headers.get('content-type')?.includes('application/json'))throw new AppError(415,'CONTENT_TYPE','Send JSON data.');
  const raw=await readText(request,maxBytes);
  try{return JSON.parse(raw);}catch{throw new AppError(400,'INVALID_JSON','Invalid JSON data.');}
}
export async function readText(request:Request,maxBytes:number):Promise<string> {
  if(Number(request.headers.get('content-length'))>maxBytes)throw new AppError(413,'TOO_LARGE','This request is too large.');
  const reader=request.body?.getReader();if(!reader)throw new AppError(400,'INVALID_JSON','Request body is required.');
  const chunks:Uint8Array[]=[];let size=0;
  while(true){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>maxBytes){await reader.cancel();throw new AppError(413,'TOO_LARGE','This request is too large.');}chunks.push(value);}
  return Buffer.concat(chunks).toString('utf8');
}
export async function handle(work:()=>Promise<Response>) {
  try{
    if(process.env.NODE_ENV==='production' && process.env.LOCAL_DEMO_MODE==='true')throw new AppError(503,'DEMO_DEPLOYMENT_BLOCKED','This demo configuration is local-only. Configure real services before deployment.');
    return await work();
  }catch(error){
    if(error instanceof AppError)return json({error:{code:error.code,message:error.message}},error.status);
    if(error instanceof ZodError)return json({error:{code:'VALIDATION_ERROR',message:'Please check the supplied details.',fields:error.issues.map(i=>({field:i.path.join('.'),message:i.message}))}},422);
    const requestId=randomUUID();
    // Error values from drivers/providers can contain submitted data; log a correlation ID and error type only.
    console.error('Request failed',{requestId,type:error instanceof Error?error.name:'Unknown'});
    return json({error:{code:'SERVER_ERROR',message:'Something went wrong. Please try again.',requestId}},500);
  }
}
