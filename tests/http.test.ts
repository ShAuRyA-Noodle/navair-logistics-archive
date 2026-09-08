import {expect,it} from 'vitest';
import {readText} from '../src/lib/http';

it('stops oversized streamed bodies without trusting content-length',async()=>{
  let cancelled=false;
  const body=new ReadableStream({start(controller){controller.enqueue(new Uint8Array(17));},cancel(){cancelled=true;}});
  const request=new Request('http://localhost',{method:'POST',body,duplex:'half'} as RequestInit);
  await expect(readText(request,16)).rejects.toMatchObject({status:413});
  expect(cancelled).toBe(true);
});
it('preserves webhook raw text for signature verification',async()=>{
  const raw=' { "name": "Navair" }\n';
  expect(await readText(new Request('http://localhost',{method:'POST',body:raw}),100)).toBe(raw);
});
