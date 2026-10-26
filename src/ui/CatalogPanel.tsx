"use client";

import { useState } from "react";
import { money, type CatalogEntry, type ProductCatalog } from "@/domain";
import { cls } from "./classes";

interface CatalogPanelProps {
  data: ProductCatalog | null;
  status: string;
  onAdd(entry: CatalogEntry): void;
  onRefresh(): void;
}

/**
 * 영업팀 제품가격표에서 제품을 고르는 패널 (④⑤, spec 11절 화면 동작).
 * @param {CatalogPanelProps} props 가격표·상태 문구·추가/새로고침 함수
 * @returns {JSX.Element} 패널
 */
export function CatalogPanel({ data, status, onAdd, onRefresh }: CatalogPanelProps) {
  const [search, setSearch] = useState("");
  const [picked, setPicked] = useState("");

  const q = search.trim().toUpperCase();
  const list = (data?.entries ?? []).filter((e) => !q || [e.model, e.title, e.sheet].some((x) => x.toUpperCase().includes(q)));
  // 코드·모델명·품목명이 정확히 같은 항목이 하나면, 또는 결과가 하나면 자동으로 선택한다.
  const exact = q ? list.filter((e) => [e.code, e.model, e.title].some((x) => x.toUpperCase() === q)) : [];
  let selectedId = list.some((e) => e.id === picked) ? picked : "";
  if (exact.length === 1 && !selectedId) selectedId = exact[0].id;
  if (list.length === 1) selectedId = list[0].id;
  const selected = list.find((e) => e.id === selectedId);

  return (
    <section className={cls.section} aria-labelledby="catalog-title">
      <h2 id="catalog-title" className={cls.h2}>
        엑셀 제품 불러오기
      </h2>
      <div className="flex flex-wrap items-center gap-3">
        <button type="button" className={cls.button} onClick={onRefresh}>
          지금 새로고침
        </button>
        <p className="whitespace-pre-wrap text-xs text-[#62728a]" data-testid="catalog-status">
          {status}
        </p>
      </div>
      <div className={`${cls.grid} mt-4`}>
        <label className={cls.label}>
          모델명 또는 품목명
          <input
            className={cls.input}
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPicked("");
            }}
            placeholder="예: EZ-2203AWG"
            autoComplete="off"
          />
        </label>
        <label className={`${cls.label} ${cls.wide}`}>
          검색 결과
          <select className={cls.input} aria-label="검색 결과" value={selectedId} onChange={(e) => setPicked(e.target.value)}>
            <option value="">{!data ? "가격표 불러오는 중" : list.length ? "제품을 선택하세요" : "검색 결과가 없습니다"}</option>
            {list.map((e) => (
              <option key={e.id} value={e.id}>
                {`${e.model || "모델명 없음"} · ${e.title} · ${e.sheet}`}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className="my-4 whitespace-pre-wrap" data-testid="catalog-preview">
        {selected && (
          <>
            {`${selected.name}\n\n단가(부가세 포함): ${selected.price === null ? "직접 입력 필요" : `${money(selected.price)}원`} / ${selected.unit}\n${selected.note}${
              selected.internalNote ? `\n내부 참고: ${selected.internalNote}` : ""
            }`}
            <div className="flex flex-wrap">
              {selected.imageIds.map((id) => (
                // 입장 쿠키가 필요한 API 응답이라 이미지 최적화를 쓰지 않는다.
                // eslint-disable-next-line @next/next/no-img-element
                <img key={id} src={`/api/catalog-image/${id}`} alt={selected.title} className="m-3 inline-block max-h-[140px] max-w-[140px]" />
              ))}
            </div>
          </>
        )}
      </div>
      <button type="button" className={cls.button} disabled={!selected} onClick={() => selected && onAdd(selected)}>
        선택 제품을 품목에 추가
      </button>
      <p className={cls.note}>같은 제품도 여러 번 추가할 수 있습니다. 품목 옆 ‘복제’를 누르면 바로 아래에 같은 품목이 추가되며 수량은 각각 수정할 수 있습니다.</p>
      <p className={cls.note}>
        가격표가 바뀌어 다시 배포되면, 화면을 열거나 새로고침할 때 연결된 품목의 규격·단가·사진이 갱신되고 바뀐 품목을 알려 드립니다. 수량과 적용률은 유지됩니다. 직접 수정하려면 해당 품목의 ‘연동 해제’를 누르세요. 단가가 없는 품목은 직접 입력해야 합니다.
      </p>
    </section>
  );
}
