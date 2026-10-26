"use client";

import { useLayoutEffect, useRef, type InputHTMLAttributes } from "react";
import { formatMoneyTyping, groupDigits } from "./draft";

interface MoneyInputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, "value" | "onChange"> {
  /** 쉼표 없는 값 */
  value: string;
  /** 쉼표를 뺀 새 값을 받는다 */
  onValue(raw: string): void;
}

/**
 * 금액 입력칸. 입력 중에 천 단위 쉼표를 붙이고 커서 위치를 유지한다 (spec 15절).
 * @param {MoneyInputProps} props 값·변경 함수와 input 속성
 * @returns {JSX.Element} 입력칸
 */
export function MoneyInput({ value, onValue, ...rest }: MoneyInputProps) {
  const ref = useRef<HTMLInputElement>(null);
  const caret = useRef<number | null>(null);

  useLayoutEffect(() => {
    const input = ref.current;
    if (caret.current !== null && input && document.activeElement === input) input.setSelectionRange(caret.current, caret.current);
    caret.current = null;
  });

  return (
    <input
      {...rest}
      ref={ref}
      type="text"
      inputMode="numeric"
      value={groupDigits(value)}
      onChange={(e) => {
        const r = formatMoneyTyping(e.target.value, e.target.selectionStart ?? e.target.value.length);
        caret.current = r.caret;
        onValue(r.raw);
      }}
    />
  );
}
