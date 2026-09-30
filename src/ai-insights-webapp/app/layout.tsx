import type { Metadata } from "next";
import { Noto_Sans } from "next/font/google";
import "./globals.css";
import Header from "./components/shared/header/Header";
import Navbar from "./components/shared/navbar/Navbar";
import { AppProvider } from "./components/providers/AppContext";

const notoSans = Noto_Sans({
  subsets: ["latin"],
  variable: "--font-noto-sans",
  display: "swap",
});

export const metadata: Metadata = {
  title: "AI Insights Platform",
  icons: {
    icon: "/images/cei-logo.png",
  },
};

const themeScript = `
(function () {
  try {
    var stored = localStorage.getItem('theme');
    var prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    var theme = stored || (prefersDark ? 'dark' : 'light');
    if (theme === 'dark') document.documentElement.classList.add('dark');
  } catch (e) {}
})();
`;

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${notoSans.variable} ${notoSans.className} h-full antialiased`}
      suppressHydrationWarning
    >
      <head>
        {/* <script dangerouslySetInnerHTML={{ __html: themeScript }} /> */}
      </head>
      <body className={`${notoSans.className} max-h-full flex flex-col`}>
        <AppProvider>
            {children}
        </AppProvider>
      </body>
    </html>
  );
}
