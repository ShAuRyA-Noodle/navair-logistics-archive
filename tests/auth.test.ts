import { describe, expect, it, vi, afterEach } from 'vitest';
import { assertSameOrigin, assertLocalDemo, hashToken } from '../src/lib/auth';
describe('authentication boundaries',()=>{
 afterEach(()=>vi.unstubAllEnvs());
 it('rejects a cross-site mutation even with cookies',()=>{
  vi.stubEnv('APP_URL','http://127.0.0.1:3000');
  expect(()=>assertSameOrigin(new Request('http://127.0.0.1:3000/api/enquiries',{method:'POST',headers:{origin:'https://attacker.example'}}))).toThrow();
 });
 it('accepts a request from whichever alias served the page, not only APP_URL',()=>{
  // Vercel gives one deployment several hostnames; a visitor on any of them is on-site.
  vi.stubEnv('APP_URL','https://navair-logistics-shauryapunj404-4961s-projects.vercel.app');
  const request=new Request('https://navair-logistics-one.vercel.app/api/enquiries',{method:'POST',headers:{
   origin:'https://navair-logistics-one.vercel.app',host:'navair-logistics-one.vercel.app','x-forwarded-host':'navair-logistics-one.vercel.app','x-forwarded-proto':'https'}});
  expect(()=>assertSameOrigin(request)).not.toThrow();
 });
 it('still rejects a cross-site origin that names a different host from the one serving',()=>{
  vi.stubEnv('APP_URL','https://navair-logistics-shauryapunj404-4961s-projects.vercel.app');
  const request=new Request('https://navair-logistics-one.vercel.app/api/enquiries',{method:'POST',headers:{
   origin:'https://attacker.example','x-forwarded-host':'navair-logistics-one.vercel.app','x-forwarded-proto':'https'}});
  expect(()=>assertSameOrigin(request)).toThrow();
 });
 it('rejects an absent origin on browser mutation routes',()=>{
  expect(()=>assertSameOrigin(new Request('http://127.0.0.1:3000/api/enquiries',{method:'POST'}))).toThrow();
 });
 it('never enables demo identity in production',()=>{
  vi.stubEnv('NODE_ENV','production');vi.stubEnv('LOCAL_DEMO_MODE','true');
  expect(()=>assertLocalDemo(new Request('http://127.0.0.1:3000'))).toThrow();
 });
 it('rejects remote-host demo requests',()=>{
  vi.stubEnv('NODE_ENV','development');vi.stubEnv('LOCAL_DEMO_MODE','true');
  expect(()=>assertLocalDemo(new Request('https://example.com'))).toThrow();
 });
 it('stores a one-way digest instead of the bearer token',()=>{
  expect(hashToken('a-test-session-token')).toHaveLength(64);
  expect(hashToken('a-test-session-token')).not.toBe('a-test-session-token');
 });
});
