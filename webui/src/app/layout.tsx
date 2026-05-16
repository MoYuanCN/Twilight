import type { Metadata } from "next";
import { GeistSans } from "geist/font/sans";
import { GeistMono } from "geist/font/mono";
import { ThemeProvider } from "@/components/theme-provider";
import { Toaster } from "@/components/ui/toaster";
import { ConfirmDialogProvider } from "@/components/ui/confirm-dialog";
import { SITE_DESCRIPTION, SITE_ICON, SITE_TITLE } from "../lib/site-config";
import "./globals.css";

const metadataIcons: Metadata["icons"] | undefined = SITE_ICON
  ? {
      icon: SITE_ICON,
      shortcut: SITE_ICON,
      apple: SITE_ICON,
    }
  : undefined;

export const metadata: Metadata = {
  title: SITE_TITLE,
  description: SITE_DESCRIPTION,
  ...(metadataIcons ? { icons: metadataIcons } : {}),
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN" suppressHydrationWarning>
      <body
        className={`${GeistSans.variable} ${GeistMono.variable} font-sans antialiased`}
      >
        <ThemeProvider
          attribute="class"
          defaultTheme="light"
          enableSystem={false}
          themes={["light", "dark"]}
          disableTransitionOnChange={false}
        >
          <ConfirmDialogProvider>
            {children}
            <Toaster />
          </ConfirmDialogProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}

