import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'MyAgentStudio',
  description: 'Agent workbench',
  icons: {
    icon: '/processmind-mark.png',
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
