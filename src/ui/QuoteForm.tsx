"use client";

import Link from "next/link";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { LeaveButton } from "@/auth/LeaveButton";
import { isCatalogType, money, validateQuote, type AccessCatalog, type AccessEntry, type CatalogEntry, type ProductCatalog, type QuoteType, type StaffProfile } from "@/domain";
import { createBrowserQuoteNumberStore, type QuoteNumberStore } from "@/numbering";
import { AccessPanel } from "./AccessPanel";
import { CatalogPanel } from "./CatalogPanel";
import { cls } from "./classes";
import {
  addAccessEntry,
  addCatalogEntry,
  changeNotice,
  detachRow,
  draftTotals,
  duplicateRow,
  editRow,
  MAX_ROWS,
  MSG_MAX_ROWS,
  newDraft,
  newRow,
  normalizeDraft,
  removeRow,
  restoreAuto,
  syncLinkedRows,
  todayText,
  toGenerateRequest,
  typeHelp,
  type AddResult,
  type EditableField,
  type QuoteDraft,
  type SaveFormat,
} from "./draft";
import { generateQuote, type GeneratedFile } from "./generate";
import { ItemsTable } from "./ItemsTable";
import { AUTO_DRAFT_KEY, browserStorage, MSG_AUTOSAVE_FAILED, readJson, readStaffPhones, SAVED_DRAFT_KEY, STAFF_PHONES_KEY, writeJson } from "./storage";

type Status = { text: string; error: boolean };
type TextField = "customer" | "title" | "contact" | "phone" | "email" | "validity" | "delivery" | "payment" | "notes";

const SUBMIT_LABEL: Record<SaveFormat, string> = { pdf: "PDF 견적서 만들기", xlsx: "Excel 견적서 만들기", both: "PDF + Excel 만들기" };
const KEEP_INPUT = "\n입력내용은 유지되어 있습니다.";

/**
 * 응답 JSON을 읽는다. 실패하면 서버의 한국어 오류 문구로 거부한다.
 * @param {string} url 조회 경로
 * @param {string} fallback 오류 문구가 없을 때 문구
 * @returns {Promise<T>} 응답 본문
 */
async function getJson<T>(url: string, fallback: string): Promise<T> {
  let response: Response;
  try {
    response = await fetch(url, { cache: "no-store" });
  } catch {
    throw new Error("서버에 연결하지 못했습니다. 잠시 후 다시 시도하세요.");
  }
  const data = (await response.json().catch(() => null)) as (T & { error?: unknown }) | null;
  if (!response.ok || data === null) throw new Error(typeof data?.error === "string" ? data.error : fallback);
  return data;
}

/**
 * 받은 파일을 내려받기로 저장한다.
 * @param {GeneratedFile[]} files 파일 목록
 * @returns {void}
 */
function downloadFiles(files: GeneratedFile[]): void {
  for (const file of files) {
    const url = URL.createObjectURL(file.blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = file.name;
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  }
}

/**
 * 오류 객체에서 화면에 보일 문구를 꺼낸다.
 * @param {unknown} e 오류
 * @returns {string} 문구
 */
function errorText(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/**
 * 견적 입력 화면 (spec 15절, 기존 웹 1.0 입력폼 구성).
 * 담당자·가격표는 서버 API에서 받고, 번호 이력·입력 초안·휴대폰 수정값은 브라우저에만 둔다.
 * @returns {JSX.Element} 입력 화면
 */
export function QuoteForm() {
  const [draft, setDraft] = useState<QuoteDraft | null>(null);
  const draftRef = useRef<QuoteDraft | null>(null);
  const [staff, setStaff] = useState<StaffProfile[]>([]);
  const [phones, setPhones] = useState<Record<string, string>>({});
  const [access, setAccess] = useState<AccessCatalog | null>(null);
  const [accessStatus, setAccessStatus] = useState("");
  const [catalog, setCatalog] = useState<ProductCatalog | null>(null);
  const catalogRef = useRef<ProductCatalog | null>(null);
  const [catalogStatus, setCatalogStatus] = useState("");
  const [notice, setNotice] = useState("");
  const [status, setStatus] = useState<Status>({ text: "", error: false });
  const [fatal, setFatal] = useState("");
  const [busy, setBusy] = useState(false);
  const storeRef = useRef<QuoteNumberStore | null>(null);
  const numberRequest = useRef(0);

  /**
   * 화면 메시지를 바꾼다.
   * @param {string} text 문구
   * @param {boolean} error 오류 표시 여부
   */
  const say = (text: string, error = false) => setStatus({ text, error });

  /**
   * 초안을 바꾸고 브라우저에 자동 저장한다. 저장하지 못하면 알리고 작업은 계속한다.
   * @param {QuoteDraft} next 새 초안
   */
  function commit(next: QuoteDraft) {
    draftRef.current = next;
    setDraft(next);
    if (!writeJson(browserStorage(), AUTO_DRAFT_KEY, next)) say(MSG_AUTOSAVE_FAILED, true);
  }

  /**
   * 현재 초안에 변경 함수를 적용한다.
   * @param {(d: QuoteDraft) => QuoteDraft} fn 변경 함수
   */
  function change(fn: (d: QuoteDraft) => QuoteDraft) {
    if (draftRef.current) commit(fn(draftRef.current));
  }

  /**
   * 줄 추가 결과를 반영한다. 100개 제한에 걸리면 알린다.
   * @param {AddResult} result 추가 결과
   */
  function applyAdd(result: AddResult) {
    if (result.error) say(result.error, true);
    else commit(result.draft);
  }

  /**
   * 자동 번호를 다시 계산한다. 직접 입력 상태면 그대로 둔다. 기록하지 않는다.
   */
  async function refreshNumber() {
    const d = draftRef.current;
    const store = storeRef.current;
    if (!d || !store || d.numberManual) return;
    const request = ++numberRequest.current;
    try {
      const number = await store.previewNext(d.date, d.staffId);
      if (request === numberRequest.current) change((x) => ({ ...x, number }));
    } catch (e) {
      if (request !== numberRequest.current) return;
      change((x) => ({ ...x, number: "" }));
      say(`견적번호 조회: ${errorText(e)}`, true);
    }
  }

  /**
   * 연동 줄을 가격표에 맞추고, 바뀐 줄이 있으면 알린다.
   * @param {ProductCatalog} data 제품가격표
   */
  function syncCatalog(data: ProductCatalog) {
    const d = draftRef.current;
    if (!d) return;
    const r = syncLinkedRows(d, data);
    if (r.draft !== d) commit(r.draft);
    if (r.changes.length) setNotice(changeNotice(r.changes));
  }

  /**
   * 제품가격표를 불러온다.
   * @returns {Promise<ProductCatalog | null>} 가격표. 실패하면 null
   */
  async function loadCatalog(): Promise<ProductCatalog | null> {
    try {
      const data = await getJson<ProductCatalog>("/api/catalog", "제품 가격표를 불러올 수 없습니다.");
      catalogRef.current = data;
      setCatalog(data);
      setCatalogStatus(`${data.sheets.length}개 시트 · ${data.entries.length}개 품목 · 연결됨${data.warnings.length ? `\n${data.warnings.join("\n")}` : ""}`);
      syncCatalog(data);
      return data;
    } catch (e) {
      setCatalogStatus(`연결 오류: ${errorText(e)}`);
      return null;
    }
  }

  /**
   * 출입통제 가격표를 불러온다.
   */
  async function loadAccess() {
    try {
      const data = await getJson<AccessCatalog>("/api/access-catalog", "출입통제 가격표를 불러올 수 없습니다.");
      setAccess(data);
      setAccessStatus(`${data.entries.length}개 품목 · 부가세 별도 기준가격`);
    } catch (e) {
      setAccessStatus(`가격표를 불러오지 못했습니다: ${errorText(e)}`);
    }
  }

  /**
   * 초안을 통째로 바꾼다(복원·불러오기). 담당자가 명단에 없으면 첫 담당자로 바꾸고 번호·가격표 연동을 다시 맞춘다.
   * @param {QuoteDraft} next 새 초안
   * @param {StaffProfile[]} list 담당자 명단
   */
  function replaceDraft(next: QuoteDraft, list: StaffProfile[]) {
    const staffId = list.some((s) => s.id === next.staffId) ? next.staffId : list[0].id;
    commit({ ...next, staffId, numberManual: staffId === next.staffId && next.numberManual });
    void refreshNumber();
    if (isCatalogType(next.quoteType)) {
      if (catalogRef.current) syncCatalog(catalogRef.current);
      else void loadCatalog();
    }
  }

  useEffect(() => {
    let cancelled = false;
    (async () => {
      let list: StaffProfile[];
      try {
        list = (await getJson<{ staff: StaffProfile[] }>("/api/staff", "담당자 설정(STAFF_CONFIG)을 확인하세요.")).staff;
        if (!list.length) throw new Error("담당자 설정(STAFF_CONFIG)을 확인하세요.");
      } catch (e) {
        if (!cancelled) setFatal(errorText(e));
        return;
      }
      if (cancelled) return;
      const storage = browserStorage();
      storeRef.current = createBrowserQuoteNumberStore(list, {
        onStorageError: () => setStatus({ text: "견적번호 발급 이력을 브라우저에 저장하지 못합니다. 이 화면을 닫으면 이력이 사라집니다.", error: true }),
      });
      setStaff(list);
      setPhones(readStaffPhones(storage));
      const base = newDraft(todayText(new Date()), list[0].id);
      const saved = normalizeDraft(readJson(storage, AUTO_DRAFT_KEY), base);
      replaceDraft(saved ?? base, list);
      if (saved) setStatus({ text: "마지막 작성 내용을 자동으로 불러왔습니다.", error: false });
      void loadAccess();
    })();
    return () => {
      cancelled = true;
    };
    // 처음 한 번만 불러온다. 이후 변경은 각 처리 함수가 맡는다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (fatal) {
    return (
      <main className="mx-auto max-w-xl p-8">
        <p role="alert" className="rounded-lg bg-[#fff0ee] p-4 text-[#a33227]">
          {fatal}
        </p>
      </main>
    );
  }
  if (!draft) {
    return <main className="mx-auto max-w-xl p-8 text-[#62728a]">입력 화면을 준비하고 있습니다…</main>;
  }

  const catalogType = isCatalogType(draft.quoteType);
  const totals = draftTotals(draft);
  const currentStaff = staff.find((s) => s.id === draft.staffId);
  const staffPhone = phones[draft.staffId] ?? currentStaff?.phone ?? "";

  /**
   * 문구 칸을 고친다.
   * @param {TextField} field 칸
   * @param {string} value 값
   */
  const setText = (field: TextField, value: string) => change((d) => ({ ...d, [field]: value }));

  /**
   * 견적서 종류를 바꾼다. ④⑤로 바꾸면 제품가격표를 불러오거나 연동 줄을 맞춘다.
   * @param {QuoteType} quoteType 종류
   */
  function setQuoteType(quoteType: QuoteType) {
    change((d) => ({ ...d, quoteType }));
    if (!isCatalogType(quoteType)) return;
    if (catalogRef.current) syncCatalog(catalogRef.current);
    else void loadCatalog();
  }

  /**
   * 작성일·작성자를 바꾼다. 직접 입력 번호 상태를 풀고 자동 번호로 돌아간다.
   * @param {Partial<QuoteDraft>} values 바뀐 값
   */
  function setNumberBasis(values: Partial<QuoteDraft>) {
    change((d) => ({ ...d, ...values, numberManual: false }));
    void refreshNumber();
  }

  /**
   * 담당자 휴대폰을 고치고 이 브라우저에 담당자별로 기억한다.
   * @param {string} value 휴대폰
   */
  function setStaffPhone(value: string) {
    const next = { ...phones, [draft!.staffId]: value };
    setPhones(next);
    if (!writeJson(browserStorage(), STAFF_PHONES_KEY, next)) say(MSG_AUTOSAVE_FAILED, true);
  }

  /**
   * 줄의 칸을 고친다.
   * @param {string} key 줄 키
   * @param {EditableField} field 칸
   * @param {string} value 값
   */
  function onEdit(key: string, field: EditableField, value: string) {
    change((d) => ({ ...d, items: d.items.map((r) => (r.key === key ? editRow(r, field, value) : r)) }));
  }

  /**
   * '입력내용 임시 저장'.
   */
  function saveDraft() {
    if (writeJson(browserStorage(), SAVED_DRAFT_KEY, draftRef.current)) say("현재 입력내용을 저장했습니다.");
    else say("입력내용을 브라우저에 저장하지 못했습니다.", true);
  }

  /**
   * '임시 저장 불러오기'. 현재 내용을 바꿀지 먼저 묻는다.
   */
  function loadDraft() {
    const saved = normalizeDraft(readJson(browserStorage(), SAVED_DRAFT_KEY), draftRef.current!);
    if (!saved) return say("저장된 입력내용이 없습니다.");
    if (!window.confirm("현재 입력내용을 저장된 내용으로 바꿀까요?")) return;
    replaceDraft(saved, staff);
    say("저장된 입력내용을 불러왔습니다.");
  }

  /**
   * '만들기': 가격표 최신 여부 확인 → 화면 검사 → 번호 확정 → 형식별 생성 → 내려받기 → 번호 기록 (spec 14절).
   * @param {FormEvent<HTMLFormElement>} e 제출 이벤트
   */
  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (busy || !storeRef.current) return;
    setBusy(true);
    try {
      let productCatalog = catalogRef.current;
      if (isCatalogType(draftRef.current!.quoteType)) {
        productCatalog = await loadCatalog();
        if (!productCatalog) {
          say(`제품 가격표를 불러오지 못했습니다.${KEEP_INPUT}`, true);
          return;
        }
      }
      const d = draftRef.current!;
      const revision = productCatalog?.revision ?? "";
      const body = (format: "pdf" | "xlsx", number: string) => toGenerateRequest(d, format, number, staffPhone, revision);
      // 화면에서 서버와 같은 검사를 먼저 한다. 최종 검사는 서버가 한다.
      const checked = validateQuote(body("pdf", d.number || "자동 번호"), staff, isCatalogType(d.quoteType) && productCatalog ? { catalog: productCatalog } : {});
      if (!checked.ok) {
        say(`${checked.error}${KEEP_INPUT}`, true);
        return;
      }
      say("견적서를 만들고 있습니다…");
      const number = await generateQuote(
        { date: d.date, staffId: d.staffId, manualNumber: d.numberManual ? d.number : undefined, saveFormat: d.outputFormat, body },
        storeRef.current,
        downloadFiles,
      );
      say(`견적서를 저장했습니다. ${number}`);
      change((x) => ({ ...x, numberManual: false }));
      await refreshNumber();
    } catch (err) {
      say(`${errorText(err)}${KEEP_INPUT}`, true);
    } finally {
      setBusy(false);
    }
  }

  const sumBox = (label: string, value: bigint, testId: string, big = false) => (
    <div>
      <span className="mb-1 block text-xs text-[#66778d]">{label}</span>
      <strong data-testid={testId} className={big ? "text-[26px] text-[#245fc2] max-[800px]:text-xl" : "text-[19px] max-[800px]:text-[15px]"}>
        {money(value)}원
      </strong>
    </div>
  );

  return (
    <main className="mx-auto w-full max-w-[1320px] px-6 pt-8 pb-40 max-[800px]:px-3">
      <div className="mb-2 flex justify-end gap-2 text-sm">
        <Link href="/" className={cls.button}>
          처음 화면
        </Link>
        <LeaveButton className={cls.button} />
      </div>
      <header className="mb-7 flex items-center justify-between gap-4 max-[800px]:flex-col max-[800px]:items-start">
        <div>
          <div className="text-xs font-bold tracking-[2px] text-[#3367b0]">NROBOTICS</div>
          <h1 className="my-1.5 text-[28px] font-bold">견적서 작성</h1>
          <p className="leading-relaxed text-[#62728a]">거래처와 품목을 입력하면 PDF 또는 Excel 견적서가 만들어집니다.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" className={cls.button} onClick={saveDraft} disabled={busy}>
            입력내용 임시 저장
          </button>
          <button type="button" className={cls.button} onClick={loadDraft} disabled={busy}>
            임시 저장 불러오기
          </button>
        </div>
      </header>

      <form onSubmit={onSubmit} noValidate>
        <fieldset disabled={busy} className="min-w-0">
          <section className={cls.section}>
            <h2 className={cls.h2}>견적서 종류</h2>
            <label className={cls.label}>
              출력 양식
              <select className={cls.input} name="quoteType" value={draft.quoteType} onChange={(e) => setQuoteType(e.target.value as QuoteType)}>
                <option value="vat">부가세 표시 견적</option>
                <option value="total">부가세 미포함 견적</option>
                <option value="cost">비용 분리 견적 (재료비·노무비·경비)</option>
                <option value="catalog">영업1팀 제품 견적 (엑셀 연동·부가세 포함)</option>
                <option value="catalog2">영업2팀 제품 견적 (엑셀 연동·부가세 포함)</option>
              </select>
            </label>
            <label className={`${cls.label} mt-3`}>
              저장 형식
              <select className={cls.input} name="outputFormat" value={draft.outputFormat} onChange={(e) => change((d) => ({ ...d, outputFormat: e.target.value as SaveFormat }))}>
                <option value="pdf">PDF</option>
                <option value="xlsx">Excel (.xlsx)</option>
                <option value="both">PDF + Excel 함께 저장</option>
              </select>
            </label>
            {catalogType && (
              <label className={`${cls.label} mt-3`}>
                <input type="checkbox" className={cls.check} checked={draft.showFee} onChange={(e) => change((d) => ({ ...d, showFee: e.target.checked }))} />
                조달수수료 안내 표시 ON / OFF (OFF: 빈칸)
              </label>
            )}
            <p className={cls.note}>{typeHelp(draft.quoteType)}</p>
          </section>

          <section className={cls.section}>
            <h2 className={cls.h2}>작성자</h2>
            <div className="flex flex-wrap gap-7" role="radiogroup" aria-label="작성자">
              {staff.map((s) => (
                <label key={s.id} className="flex items-center text-[15px]">
                  <input type="radio" name="staff" className={cls.check} checked={draft.staffId === s.id} onChange={() => setNumberBasis({ staffId: s.id })} />
                  {`${s.name} · ${String(s.start).padStart(3, "0")}부터`}
                </label>
              ))}
            </div>
            <div className={`${cls.grid} mt-4`}>
              <label className={cls.label}>
                견적서 담당자
                <input className={cls.input} value={currentStaff?.display ?? ""} readOnly />
              </label>
              <label className={cls.label}>
                담당자 휴대폰번호
                <input className={cls.input} type="tel" maxLength={30} placeholder="010-0000-0000" value={staffPhone} onChange={(e) => setStaffPhone(e.target.value)} />
              </label>
            </div>
            <p className={cls.note}>
              이름·직급은 관리자가 설정합니다. 수정한 휴대폰번호는 이 브라우저에만 저장됩니다. 견적번호는 작성일·작성자 기준으로 자동 발급되며, 견적서 저장 후 다음 번호로 넘어갑니다. PDF와 Excel을 함께 저장하면 같은 견적번호를 사용합니다.
            </p>
          </section>

          <section className={cls.section}>
            <h2 className={cls.h2}>거래처 및 견적 정보</h2>
            <div className={cls.grid}>
              <label className={cls.label}>
                거래처 *
                <input className={cls.input} name="customer" maxLength={100} placeholder="예: 한국수자원공사" value={draft.customer} onChange={(e) => setText("customer", e.target.value)} />
              </label>
              <label className={`${cls.label} ${cls.wide}`}>
                견적 제목 *
                <input className={cls.input} name="title" maxLength={200} placeholder="예: 출입통제시스템 설치 견적" value={draft.title} onChange={(e) => setText("title", e.target.value)} />
              </label>
              <label className={cls.label}>
                거래처 담당자
                <input className={cls.input} name="contact" maxLength={100} placeholder="이름 / 직함" value={draft.contact} onChange={(e) => setText("contact", e.target.value)} />
              </label>
              <label className={cls.label}>
                전화번호
                <input className={cls.input} name="phone" maxLength={50} value={draft.phone} onChange={(e) => setText("phone", e.target.value)} />
              </label>
              <label className={cls.label}>
                이메일
                <input className={cls.input} name="email" type="email" maxLength={100} value={draft.email} onChange={(e) => setText("email", e.target.value)} />
              </label>
              <label className={cls.label}>
                작성일 *
                <input className={cls.input} name="date" type="date" value={draft.date} onChange={(e) => setNumberBasis({ date: e.target.value })} />
              </label>
              <div className={`${cls.label} ${cls.wide}`}>
                <label htmlFor="quote-number">견적번호 {draft.numberManual ? "(직접 입력)" : "(자동)"}</label>
                <div className="flex items-end gap-2">
                  <input
                    id="quote-number"
                    className={cls.input}
                    name="number"
                    maxLength={100}
                    value={draft.number}
                    onChange={(e) => {
                      ++numberRequest.current;
                      const number = e.target.value;
                      change((d) => ({ ...d, number, numberManual: true }));
                    }}
                  />
                  <button type="button" className={`${cls.button} shrink-0`} onClick={() => setNumberBasis({})}>
                    자동번호 적용
                  </button>
                </div>
              </div>
            </div>
          </section>

          {catalogType ? (
            <CatalogPanel data={catalog} status={catalogStatus} onAdd={(entry: CatalogEntry) => applyAdd(addCatalogEntry(draftRef.current!, entry))} onRefresh={() => void loadCatalog()} />
          ) : (
            <AccessPanel data={access} status={accessStatus} onAdd={(entry: AccessEntry) => applyAdd(addAccessEntry(draftRef.current!, entry))} onRefresh={() => void loadAccess()} />
          )}

          <section className={cls.section}>
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-lg font-bold">품목</h2>
              <button
                type="button"
                className={cls.button}
                onClick={() => (draft.items.length >= MAX_ROWS ? say(MSG_MAX_ROWS, true) : change((d) => ({ ...d, items: [...d.items, newRow()] })))}
              >
                ＋ 품목 추가
              </button>
            </div>
            {notice && (
              <p role="status" className="mb-3 whitespace-pre-wrap rounded-lg bg-[#fff8e1] p-3 text-sm text-[#7a5a00]" data-testid="catalog-notice">
                {notice}
              </p>
            )}
            <ItemsTable
              quoteType={draft.quoteType}
              items={draft.items}
              lines={totals.lines}
              groups={totals.groups}
              catalog={catalog}
              onEdit={onEdit}
              onRestoreAuto={(key, which) => change((d) => ({ ...d, items: d.items.map((r) => (r.key === key ? restoreAuto(r, which) : r)) }))}
              onDuplicate={(key) => applyAdd(duplicateRow(draftRef.current!, key))}
              onRemove={(key) => change((d) => removeRow(d, key))}
              onDetach={(key) => change((d) => detachRow(d, key))}
            />
            <label className="mt-4 flex items-center text-[15px]">
              <input type="checkbox" className={cls.check} checked={draft.blankRows} onChange={(e) => change((d) => ({ ...d, blankRows: e.target.checked }))} />
              품목 아래에 빈 행 2줄 추가
            </label>
            <label className="mt-3 flex items-center text-[15px]">
              <input type="checkbox" className={cls.check} checked={draft.mergeCategories} onChange={(e) => change((d) => ({ ...d, mergeCategories: e.target.checked }))} />
              같은 구분 묶기 (연속된 행의 순번·구분 셀 병합)
            </label>
            <p className={cls.note}>
              적용률은 PDF에 표시되지 않고 계산에만 사용합니다. 적용률 100%는 정상가이며 90% 입력 시 10% 할인됩니다. 할인 적용 후 원 단위로 반올림합니다. 일반 견적의 품목 행은 동일한 높이이며, 제품 견적은 엑셀의 행 높이·글꼴·색상·사진 크기를 반영합니다. 빈 행은 낮은 높이로 표시합니다. 제품 모델 견적은 페이지당 최대 4품목이며 품목 행을 나누지 않습니다. 나머지 견적은 A4 한 페이지에 맞춰 자동 축소됩니다. 단가 기준은 상단 견적서 종류의 안내를 확인하세요. 수량은 소수 셋째 자리까지 입력할 수 있습니다.
            </p>
          </section>

          <section className={cls.section}>
            <h2 className={cls.h2}>거래 조건 및 참고사항</h2>
            <div className={cls.grid}>
              <label className={cls.label}>
                견적 유효기간
                <input className={cls.input} name="validity" maxLength={100} value={draft.validity} onChange={(e) => setText("validity", e.target.value)} />
              </label>
              <label className={cls.label}>
                납품 조건
                <input className={cls.input} name="delivery" maxLength={100} value={draft.delivery} onChange={(e) => setText("delivery", e.target.value)} />
              </label>
              <label className={cls.label}>
                결제 조건
                <input className={cls.input} name="payment" maxLength={100} value={draft.payment} onChange={(e) => setText("payment", e.target.value)} />
              </label>
              <label className={`${cls.label} col-span-full`}>
                참고사항
                <textarea className={cls.input} name="notes" rows={5} maxLength={2000} value={draft.notes} onChange={(e) => setText("notes", e.target.value)} />
              </label>
            </div>
          </section>
        </fieldset>

        <p className="leading-relaxed text-[#62728a]">
          공급자: 주식회사 앤로보틱스 · 대표 김종서 · 140-81-01965
          <br />
          저장 위치: 완료 후 내려받은 파일을 내 PC에 저장
        </p>
        {status.text && (
          <div
            role="status"
            aria-live="polite"
            data-testid="status"
            className={`my-4 whitespace-pre-wrap break-all rounded-lg p-4 ${status.error ? "bg-[#fff0ee] text-[#a33227]" : "bg-[#e8f3eb] text-[#225533]"}`}
          >
            {status.text}
          </div>
        )}

        <div className="fixed inset-x-0 bottom-0 flex items-center justify-between gap-5 border-t border-[#dce3ed] bg-white px-7 py-4 shadow-[0_-4px_20px_#223b5210] max-[800px]:flex-wrap max-[800px]:p-3">
          <div className="flex flex-wrap items-center gap-5 max-[800px]:gap-4">
            {draft.quoteType !== "total" && sumBox(catalogType ? "품목 합계" : "공급가액", totals.subtotal, "sum-subtotal")}
            {(draft.quoteType === "vat" || draft.quoteType === "cost") && sumBox("부가세 10%", totals.tax, "sum-tax")}
            {catalogType && totals.subtotal >= BigInt(50_000_000) && sumBox("2% 할인 적용금액", totals.discounted, "sum-discounted")}
            {catalogType && sumBox("조달수수료 0.54% (별도)", totals.fee, "sum-fee")}
            {sumBox("총 견적금액", totals.total, "sum-total", true)}
            {totals.error && <span className="text-sm text-[#a33227]">{totals.error}</span>}
          </div>
          <button type="submit" className={cls.primary} disabled={busy}>
            {busy ? "만드는 중…" : SUBMIT_LABEL[draft.outputFormat]}
          </button>
        </div>
      </form>
    </main>
  );
}
