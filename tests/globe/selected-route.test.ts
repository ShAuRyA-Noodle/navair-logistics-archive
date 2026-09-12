import assert from 'node:assert/strict';
import { test } from 'node:test';
import { COUNTRIES, COUNTRY_BY_CODE } from '../../src/components/globe/countries';
import { selectedRouteGeometry, countryPosition } from '../../src/components/globe/selected-route';

test('all selectable countries have unique valid coordinates', () => {
 assert.equal(new Set(COUNTRIES.map(c => c.code)).size, COUNTRIES.length);
 assert.ok(COUNTRIES.length >= 195);
 for (const c of COUNTRIES) { assert.ok(Math.abs(c.latitude)<=90 && Math.abs(c.longitude)<=180); assert.ok(Number.isFinite(countryPosition(c).length())); }
});
test('India to USA has finite route geometry and coincident selections have none', () => {
 const india=COUNTRY_BY_CODE.get('IN')!, usa=COUNTRY_BY_CODE.get('US')!;
 const result=selectedRouteGeometry(india,usa)!;
 for (const key of ['position','flatPosition']) for (const n of result.geometry.getAttribute(key).array) assert.ok(Number.isFinite(n));
 assert.equal(selectedRouteGeometry(india,india),null);
 result.geometry.dispose();
});
test('dateline route records a seam and antipodal route remains finite', () => {
 const point=(longitude:number)=>({code:'XX',name:'Test',latitude:0,longitude});
 const crossing=selectedRouteGeometry(point(170),point(-170))!;
 assert.equal(crossing.seam,0.5); crossing.geometry.dispose();
 const opposite=selectedRouteGeometry(point(0),point(180))!;
 for (const n of opposite.geometry.attributes.position.array) assert.ok(Number.isFinite(n));
 opposite.geometry.dispose();
});
