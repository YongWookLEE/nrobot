/**
 * 입력 화면에서 되풀이해 쓰는 Tailwind 클래스 (기존 웹 1.0 화면의 색·간격을 따른다).
 */
export const cls = {
  section: "mb-5 rounded-2xl border border-[#e1e6ed] bg-white p-6 max-[800px]:p-4",
  h2: "mb-5 text-lg font-bold",
  grid: "grid grid-cols-3 gap-[18px] max-[800px]:grid-cols-1",
  wide: "col-span-2 max-[800px]:col-span-1",
  label: "block min-w-0 text-[13px] font-bold",
  input:
    "mt-[7px] w-full min-w-0 rounded-[7px] border border-[#c9d2df] bg-white p-[11px] text-[15px] font-normal text-[#20304a] focus:border-[#477fcf] focus:outline-2 focus:outline-[#94b9ee] read-only:bg-[#f5f7fa] disabled:bg-[#f5f7fa]",
  cellInput:
    "w-full rounded-[7px] border border-[#c9d2df] bg-white p-[9px] text-sm text-[#20304a] focus:border-[#477fcf] focus:outline-2 focus:outline-[#94b9ee] read-only:bg-[#f5f7fa]",
  button:
    "cursor-pointer rounded-[7px] border border-[#c9d2df] bg-white px-4 py-2.5 text-[#20304a] hover:bg-[#edf3fb] disabled:cursor-not-allowed disabled:opacity-50",
  small: "cursor-pointer rounded-[7px] border border-[#c9d2df] bg-white px-2 py-1 text-xs hover:bg-[#edf3fb] disabled:opacity-50",
  primary:
    "cursor-pointer rounded-[7px] bg-[#245fc2] px-7 py-3.5 font-bold text-white hover:bg-[#184ea6] disabled:cursor-wait disabled:opacity-50",
  note: "mt-2.5 text-xs leading-relaxed text-[#62728a]",
  check: "mr-2 inline-block size-4 align-middle",
} as const;
