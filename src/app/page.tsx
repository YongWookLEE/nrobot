import Link from "next/link";
import { LeaveButton } from "@/auth/LeaveButton";

const QUOTE_KINDS = [
  ["① 부가세 표시 견적", "단가는 부가세 별도, 합계에 부가세 10%를 더합니다."],
  ["② 부가세 미포함 견적", "부가세 없이 공급가액만 표시합니다."],
  ["③ 비용 분리 견적", "재료비·노무비·경비로 나누고 부가세 10%를 더합니다."],
  ["④⑤ 영업팀 제품 견적", "제품가격표의 부가세 포함 단가를 쓰고, 5천만 원 이상은 2% 할인합니다."],
] as const;

/**
 * 입장 후 처음 보는 랜딩페이지. '견적서 작성'에서 /quote 입력 화면으로 이동한다.
 * @returns {JSX.Element} 랜딩페이지
 */
export default function Home() {
  return (
    <main className="mx-auto flex min-h-screen w-full max-w-4xl flex-col px-6 py-8 max-[800px]:px-4">
      <div className="flex justify-end">
        <LeaveButton className="cursor-pointer rounded-[7px] border border-[#c9d2df] bg-white px-4 py-2 text-sm text-[#20304a] hover:bg-[#edf3fb] disabled:opacity-50" />
      </div>
      <section className="mt-10 rounded-2xl border border-[#e1e6ed] bg-white p-10 max-[800px]:mt-6 max-[800px]:p-6">
        <div className="text-xs font-bold tracking-[2px] text-[#3367b0]">NROBOTICS</div>
        <h1 className="mt-2 text-3xl font-bold max-[800px]:text-2xl">앤로보틱스 견적서</h1>
        <p className="mt-4 leading-relaxed text-[#62728a]">
          거래처와 품목을 입력하면 회사 양식의 PDF·Excel 견적서를 만들어 내려받습니다.
          <br />
          입력 중인 내용과 견적번호 이력은 지금 쓰는 브라우저에만 저장됩니다.
        </p>
        <Link
          href="/quote"
          className="mt-8 inline-block rounded-[7px] bg-[#245fc2] px-8 py-4 text-lg font-bold text-white hover:bg-[#184ea6]"
        >
          견적서 작성
        </Link>
      </section>
      <section className="mt-6 grid grid-cols-2 gap-4 max-[800px]:grid-cols-1">
        {QUOTE_KINDS.map(([title, body]) => (
          <div key={title} className="rounded-xl border border-[#e1e6ed] bg-white p-5">
            <h2 className="font-bold">{title}</h2>
            <p className="mt-2 text-sm leading-relaxed text-[#62728a]">{body}</p>
          </div>
        ))}
      </section>
      <p className="mt-8 text-sm text-[#62728a]">공급자: 주식회사 앤로보틱스 · 대표 김종서 · 140-81-01965</p>
    </main>
  );
}
