// Injectable fetch. Avoids `typeof fetch`, which under Bun's types also requires `fetch.preconnect`.
export type Fetcher = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
