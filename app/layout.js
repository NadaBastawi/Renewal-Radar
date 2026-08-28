import './globals.css';

export const metadata = {
  title: 'Renewal Radar',
  description: 'Harbourline renewal intelligence for retained client accounts.',
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
