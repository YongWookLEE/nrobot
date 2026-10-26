import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "앤로보틱스 견적서",
  description: "(주)앤로보틱스 견적서 작성",
};

/**
 * 모든 화면의 공통 틀.
 * @param {LayoutProps<"/">} props 하위 화면
 * @returns {JSX.Element} html 문서
 */
export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="ko" className="h-full antialiased">
      <body className="flex min-h-full flex-col">{children}</body>
    </html>
  );
}
