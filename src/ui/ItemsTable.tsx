"use client";

import { isCatalogType, money, type ProductCatalog, type QuoteType } from "@/domain";
import { cls } from "./classes";
import { MSG_CATALOG_MISSING, type EditableField, type ItemRow } from "./draft";
import { MoneyInput } from "./MoneyInput";

interface ItemsTableProps {
  quoteType: QuoteType;
  items: ItemRow[];
  lines: bigint[];
  groups: number[];
  catalog: ProductCatalog | null;
  onEdit(key: string, field: EditableField, value: string): void;
  onRestoreAuto(key: string, which: "labor" | "expense"): void;
  onDuplicate(key: string): void;
  onRemove(key: string): void;
  onDetach(key: string): void;
}

/**
 * 품목 표. ③에서만 재료비·노무비·경비 열을 보이고 단가 열을 숨긴다.
 * 제품가격표 연동 줄은 품목명·구분·단위·비고·단가가 읽기 전용이다 (단가가 없는 제품은 단가만 입력).
 * @param {ItemsTableProps} props 줄 목록·계산 결과·가격표·변경 함수
 * @returns {JSX.Element} 품목 표
 */
export function ItemsTable({ quoteType, items, lines, groups, catalog, onEdit, onRestoreAuto, onDuplicate, onRemove, onDetach }: ItemsTableProps) {
  const cost = quoteType === "cost";
  const catalogType = isCatalogType(quoteType);
  const textLimit = catalogType ? 10000 : 500;

  return (
    <div className="overflow-auto">
      <table className="w-full min-w-[980px] table-fixed border-collapse">
        <colgroup>
          <col className="w-[4%]" />
          <col className="w-[11%]" />
          <col className="w-[25%]" />
          <col className="w-[9%]" />
          <col className="w-[6%]" />
          <col className="w-[8%]" />
          {cost ? (
            <>
              <col className="w-[11%]" />
              <col className="w-[11%]" />
              <col className="w-[11%]" />
            </>
          ) : (
            <col className="w-[13%]" />
          )}
          <col className="w-[13%]" />
          <col className="w-[14%]" />
          <col className="w-[7%]" />
        </colgroup>
        <thead>
          <tr className="border-b border-[#dfe5ec] text-left text-xs text-[#62728a]">
            <th className="px-1 py-2.5">번호</th>
            <th className="px-1 py-2.5">구분</th>
            <th className="px-1 py-2.5">품목명 *</th>
            <th className="px-1 py-2.5">적용률 (%)</th>
            <th className="px-1 py-2.5">단위</th>
            <th className="px-1 py-2.5">수량 *</th>
            {cost ? (
              <>
                <th className="px-1 py-2.5">재료비 단가 *</th>
                <th className="px-1 py-2.5">노무비 단가 *</th>
                <th className="px-1 py-2.5">경비 단가 *</th>
              </>
            ) : (
              <th className="px-1 py-2.5">단가 (원) *</th>
            )}
            <th className="px-1 py-2.5 text-right">금액 (원)</th>
            <th className="px-1 py-2.5">비고</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {items.map((row, i) => {
            const linked = catalogType && row.catalogId !== "";
            const entry = linked ? catalog?.entries.find((e) => e.id === row.catalogId) : undefined;
            const missing = linked && catalog !== null && !entry;
            const priceLocked = linked && !(entry && entry.price === null);
            const edit = (field: EditableField) => (e: { target: { value: string } }) => onEdit(row.key, field, e.target.value);
            return (
              <tr key={row.key} className="border-b border-[#edf0f5] align-top" data-testid="item-row">
                <td className="px-1 py-2 pt-4 text-center">{groups[i]}</td>
                <td className="px-1 py-2">
                  <input className={cls.cellInput} aria-label="구분" value={row.category} readOnly={linked} maxLength={textLimit} onChange={edit("category")} />
                </td>
                <td className="px-1 py-2">
                  {linked && (
                    <div className="mb-1 flex items-center gap-1 text-xs">
                      엑셀 연동 중
                      <button type="button" className={cls.small} onClick={() => onDetach(row.key)}>
                        연동 해제
                      </button>
                    </div>
                  )}
                  <textarea className={cls.cellInput} aria-label="품목명" rows={2} value={row.name} readOnly={linked} maxLength={textLimit} onChange={edit("name")} />
                  {missing && (
                    <p role="alert" className="mt-1 text-xs text-[#a33227]">
                      {MSG_CATALOG_MISSING}
                    </p>
                  )}
                </td>
                <td className="px-1 py-2">
                  <input className={cls.cellInput} aria-label="적용률" inputMode="decimal" maxLength={6} value={row.priceRate} onChange={edit("priceRate")} title="100%는 정상가, 90%는 10% 할인" />
                </td>
                <td className="px-1 py-2">
                  <input className={cls.cellInput} aria-label="단위" value={row.unit} readOnly={linked} maxLength={catalogType ? 10000 : 20} onChange={edit("unit")} />
                </td>
                <td className="px-1 py-2">
                  <input className={cls.cellInput} aria-label="수량" inputMode="decimal" maxLength={11} value={row.qty} onChange={edit("qty")} />
                </td>
                {cost ? (
                  <>
                    <td className="px-1 py-2">
                      <MoneyInput className={cls.cellInput} aria-label="재료비" maxLength={15} value={row.material} onValue={(v) => onEdit(row.key, "material", v)} />
                    </td>
                    {(["labor", "expense"] as const).map((k) => {
                      const auto = k === "labor" ? row.autoLabor : row.autoExpense;
                      return (
                        <td key={k} className="px-1 py-2">
                          <MoneyInput className={cls.cellInput} aria-label={k === "labor" ? "노무비" : "경비"} maxLength={15} value={row[k]} onValue={(v) => onEdit(row.key, k, v)} />
                          <button
                            type="button"
                            className={`${cls.small} mt-1`}
                            title={k === "labor" ? "재료비 × 281.25% (원 단위 반올림)" : "노무비 × 3% (원 단위 반올림)"}
                            onClick={() => onRestoreAuto(row.key, k)}
                          >
                            {auto ? "자동 적용 중" : "자동으로 복원"}
                          </button>
                        </td>
                      );
                    })}
                  </>
                ) : (
                  <td className="px-1 py-2">
                    <MoneyInput className={cls.cellInput} aria-label="단가" maxLength={15} value={row.price} readOnly={priceLocked} onValue={(v) => onEdit(row.key, "price", v)} />
                  </td>
                )}
                <td className="px-1 py-2 pt-4 text-right tabular-nums" data-testid="line-amount">
                  {money(lines[i] ?? BigInt(0))}원
                </td>
                <td className="px-1 py-2">
                  <textarea className={cls.cellInput} aria-label="비고" rows={2} value={row.note} readOnly={linked} maxLength={catalogType ? 10000 : 300} onChange={edit("note")} />
                </td>
                <td className="px-1 py-2">
                  <div className="flex flex-col gap-1">
                    <button type="button" className={cls.small} aria-label={`${i + 1}번 품목 복제`} onClick={() => onDuplicate(row.key)}>
                      복제
                    </button>
                    <button type="button" className={`${cls.small} text-[#a44343]`} aria-label={`${i + 1}번 품목 삭제`} onClick={() => onRemove(row.key)}>
                      삭제
                    </button>
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
