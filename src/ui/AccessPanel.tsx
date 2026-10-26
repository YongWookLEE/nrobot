"use client";

import { useState } from "react";
import { money, type AccessCatalog, type AccessEntry } from "@/domain";
import { cls } from "./classes";

interface AccessPanelProps {
  data: AccessCatalog | null;
  status: string;
  onAdd(entry: AccessEntry): void;
  onRefresh(): void;
}

/**
 * 출입통제 가격표에서 품목을 고르는 패널 (①②③, spec 10절 화면 동작).
 * 소요군은 검색 필터로만 쓰고 품목에는 넣지 않는다.
 * @param {AccessPanelProps} props 가격표·상태 문구·추가/새로고침 함수
 * @returns {JSX.Element} 패널
 */
export function AccessPanel({ data, status, onAdd, onRefresh }: AccessPanelProps) {
  const [group, setGroup] = useState("");
  const [search, setSearch] = useState("");
  const [picked, setPicked] = useState("");

  const entries = data?.entries ?? [];
  const groups = [...new Set(entries.map((e) => e.category))];
  const activeGroup = groups.includes(group) ? group : "";
  const q = search.trim().toLowerCase();
  const list = entries.filter(
    (e) => (!activeGroup || e.category === activeGroup) && (!q || [e.title, e.model, e.category, e.note].join(" ").toLowerCase().includes(q)),
  );
  // 결과가 하나면 자동으로 선택한다.
  const selectedId = list.some((e) => e.id === picked) ? picked : list.length === 1 ? list[0].id : "";
  const selected = list.find((e) => e.id === selectedId);

  return (
    <section className={cls.section} aria-labelledby="access-title">
      <h2 id="access-title" className={cls.h2}>
        출입통제 가격표에서 품목 선택
      </h2>
      <div className={cls.grid}>
        <label className={cls.label}>
          소요군
          <select className={cls.input} value={activeGroup} onChange={(e) => setGroup(e.target.value)}>
            <option value="">전체 소요군</option>
            {groups.map((g) => (
              <option key={g} value={g}>
                {g}
              </option>
            ))}
          </select>
        </label>
        <label className={cls.label}>
          품목명 또는 모델명 검색
          <input className={cls.input} value={search} onChange={(e) => setSearch(e.target.value)} placeholder="예: DCU, EZ-0420BIS, 설치" autoComplete="off" />
        </label>
        <label className={cls.label}>
          품목 선택
          <select className={cls.input} aria-label="품목 선택" value={selectedId} onChange={(e) => setPicked(e.target.value)}>
            <option value="">{!data ? "가격표 불러오는 중" : list.length ? "품목을 선택하세요" : "검색 결과 없음"}</option>
            {list.map((e) => (
              <option key={e.id} value={e.id}>
                {`${e.category} · ${e.title}${e.model ? ` / ${e.model}` : ""} · ${money(e.price)}원`}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className="my-4 whitespace-pre-wrap" data-testid="access-preview">
        {selected
          ? `${selected.name}\n부가세 별도 ${money(selected.price)}원${selected.note ? `\n${selected.note}` : ""}\n3번 견적 입력 위치: ${selected.costBucket === "labor" ? "노무비" : "재료비"}`
          : ""}
      </div>
      <div className="flex flex-wrap gap-2">
        <button type="button" className={cls.button} disabled={!selected} onClick={() => selected && onAdd(selected)}>
          선택 품목 추가
        </button>
        <button type="button" className={cls.button} onClick={onRefresh}>
          가격표 새로고침
        </button>
      </div>
      <p className={cls.note}>
        소요군은 검색에만 사용합니다. 구분에는 품목 종류, 품목명에는 모델명이 들어갑니다. 모델명이 없는 비용 항목은 품목 종류를 표시합니다. 1·2번은 부가세 별도 단가로 입력합니다. 3번은 제품을 재료비에, 설치·철거·이전설치·배관배선 비용을 노무비에 넣고 나머지는 0원으로 입력합니다. 단가와 모든 비용은 직접 수정할 수 있습니다. 같은 품목도 여러 번 추가할 수 있습니다. 가격표를 새로고침해도 이미 추가한 품목과 수정한 가격은 유지됩니다.
      </p>
      <p className={cls.note}>{status}</p>
    </section>
  );
}
