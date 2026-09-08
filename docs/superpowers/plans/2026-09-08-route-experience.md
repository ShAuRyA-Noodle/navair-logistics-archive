# Route insights and exporter experience

The user's correction authorizes a coherent landing page, route-search forecast graph, and nonblocking route conditions while filling the guest form. Existing identity, acceptance, and private finance boundaries remain in effect unless the user explicitly changes forecast visibility.

## Experience

- Home opens with a concise freight introduction, services, and a three-step enquiry process. The first-time exporter form is integrated below and reachable through the main action.
- Selecting source, destination, and mode retrieves public aggregate conditions for a published route. Bombay resolves to Mumbai through database-backed aliases. Unknown routes and sparse evidence are identified honestly; observed early arrivals never become a promise about future deliveries.
- A dedicated forecast page supports source/destination/mode search, 1–8 weeks, and 80%/95% uncertainty coverage. Only authorized accepted routes return price history. The chart combines dated weekly historical selling prices, future projections, uncertainty band, axes, boundary, accessible readout, and table. Historical data remains visible when projection evidence is insufficient.
- Eight explicitly synthetic routes and accepted demo journeys permit customer demonstrations without bypassing acceptance rules.

## Boundaries and implementation

Root owns database migration, public aggregate function, aliases, route forecast retrieval, validation and security tests. A public aggregate function exposes no shipment IDs, names, prices or raw events; suppress detailed statistics below five records. Private routes remain inaccessible publicly. Row policies on source data stay intact. New route forecast retrieval checks route access before reading observations and selects the latest bounded history, with unit/currency comparability.

Terra tasks own chart/analyzer/portal integration, landing/form/notice, and demo seed expansion independently. Existing server modules remain reusable; no new runtime dependencies or production services.

## Verification

Add failing database-backed tests for alias search, unknown/private/sparse routes, public raw-record denial, fresh aggregate changes, route forecast access, and historical output. Then implement, migrate locally, and seed without clearing user work. Run typecheck, complete tests and build. Verify HTTP graph/notice endpoints and browser interactions for homepage, form route changes, graph controls, and narrow layout. Record observed results and remaining limitations.

## Delivered verification

Implemented and checked locally on 8 September 2026. Type checking, 60 automated tests, and the production build pass. HTTP checks cover the eight-route catalog, Bombay alias, public aggregate notices, anonymous/pending forecast denial, accepted customer price history, confidence ranges, and private-field exclusion. Browser checks confirmed a Delhi–Mumbai graph with historical/future data, automatic 8-week/80% to 4-week/95% updates, and a Delhi–Dubai notice reporting database-derived counts and delay duration. Phone-width forecast controls were inspected and the viewport restored. Local synthetic history remains clearly labelled. Raw Vitest invocation now fails before any database access; use the disposable-database npm test harness.
