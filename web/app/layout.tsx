import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import './globals.css';

export const metadata: Metadata = {
  title: 'Second Opinion — a trust layer on the CoinMarketCap API',
  description:
    'Cross-checks CoinMarketCap data against itself, scores what it finds out of 100 and answers ACT, CAUTION ' +
    'or DO_NOT_ACT with the endpoint answers behind every statement.',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <div className="shell">
          <header className="masthead">
            <h1>
              <a href="/">Second Opinion</a>
            </h1>
            <nav>
              <a href="/">Check an asset</a>
              <a href="/audit">API audit</a>
            </nav>
          </header>
          <main>{children}</main>
          <footer>
            Second Opinion places no order, signs nothing and holds no wallet. It reads the CoinMarketCap API and
            says how much of what it read agrees with itself. The API key is read on the server and never sent to
            this page.
          </footer>
        </div>
      </body>
    </html>
  );
}
