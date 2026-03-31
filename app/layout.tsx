import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Coded — App Engine",
  description: "CodeSpring-style app engine for rapid feature scaffolding",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body style={{ margin: 0, fontFamily: "system-ui, sans-serif", background: "#f8fafc" }}>
        {children}
      </body>
    </html>
  );
}
