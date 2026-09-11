import {describe,it,expect} from 'vitest';
import {__testing} from '../src/lib/news/analysis';

// The separation between sourced fact and freight quote is the whole basis of shipping an
// AI layer next to a backtested price forecast, so it is pinned by tests.
describe('what the analysis layer refuses to say', () => {
  const blocked = (text: string) => __testing.violatesRules(text) !== null;

  it('allows a sourced macro figure, which is the evidence the analysis rests on', () => {
    expect(blocked('India exported **$37.1 bn** to the UAE in 2024 (UN Comtrade)')).toBe(false);
    expect(blocked('Brent crude last settled at US$70.40 (US EIA)')).toBe(false);
    expect(blocked('The UAE applied an average MFN tariff of 4.8% in 2021 (WTO)')).toBe(false);
  });

  it('refuses a freight quote however it is phrased', () => {
    expect(blocked('Air freight is running at $7 per kg on this lane')).toBe(true);
    expect(blocked('Expect about ₹95,000 per container')).toBe(true);
    expect(blocked('Shipping costs around US$2,400 for a 40ft box')).toBe(true);
    expect(blocked('Current freight rate is stable')).toBe(true);
  });

  it('refuses a prediction about cost direction', () => {
    expect(blocked('Shipping costs will rise next month')).toBe(true);
    expect(blocked('Expect higher freight costs')).toBe(true);
    expect(blocked('Rates may increase if the closure holds')).toBe(true);
    expect(blocked('Prices could climb sharply')).toBe(true);
    expect(blocked('a 12% increase')).toBe(true);
  });

  it('allows the operational language this feature exists to produce', () => {
    expect(blocked('Vessels rerouting around the Cape add **10-14 days** to transit')).toBe(false);
    expect(blocked('Book space **two weeks** earlier than usual')).toBe(false);
    expect(blocked('Insurers may require extra war-risk clauses on this routing')).toBe(false);
    expect(blocked('Port queues at **Jeddah** could grow')).toBe(false);
  });
});
