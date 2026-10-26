import type { Metadata } from "next";
import { QuoteForm } from "@/ui/QuoteForm";

export const metadata: Metadata = {
  title: "견적서 작성 - 앤로보틱스 견적서",
};

/**
 * 견적 입력 화면 경로. 입장 확인은 proxy가 맡는다.
 * @returns {JSX.Element} 입력 화면
 */
export default function QuotePage() {
  return <QuoteForm />;
}
