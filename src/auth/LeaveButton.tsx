"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

/** '나가기' 버튼: 입장 쿠키를 지우고 입장 페이지로 이동한다. */
export function LeaveButton({ className }: { className?: string }) {
  const [busy, setBusy] = useState(false);
  const router = useRouter();

  async function leave() {
    setBusy(true);
    try {
      await fetch("/api/leave", { method: "POST" });
    } finally {
      router.replace("/enter");
      router.refresh();
    }
  }

  return (
    <button
      type="button"
      onClick={leave}
      disabled={busy}
      className={className ?? "rounded border border-gray-300 px-3 py-1 text-sm text-gray-700 hover:bg-gray-100 disabled:opacity-50"}
    >
      나가기
    </button>
  );
}

export default LeaveButton;
