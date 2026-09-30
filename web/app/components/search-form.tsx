/**
 * The search field. A plain GET form on purpose: it needs no JavaScript in the browser, the result is a URL a
 * visitor can share, and there is nothing on this page for a client component to hold.
 */
export function SearchForm({ value = '' }: { value?: string }) {
  return (
    <form className="search" action="/asset" method="get">
      <label className="visually-hidden" htmlFor="q">
        Symbol or CoinMarketCap ID
      </label>
      <input
        id="q"
        name="q"
        type="text"
        defaultValue={value}
        placeholder="PAXG, BTC, or a numeric CMC ID"
        autoComplete="off"
        spellCheck={false}
        required
      />
      <button type="submit">Check</button>
    </form>
  );
}
