"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";

export function EnterForm({ configured }: { configured: boolean }) {
  const [password, setPassword] = useState("");
  const [error, setError] = useState(configured ? "" : "관리자가 비밀번호를 설정하지 않았습니다");
  const [busy, setBusy] = useState(false);
  const router = useRouter();

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/enter", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ password }),
      });
      if (res.ok) {
        router.replace("/");
        router.refresh();
        return;
      }
      const body = (await res.json().catch(() => null)) as { error?: string } | null;
      setError(body?.error ?? "비밀번호를 확인하세요");
    } catch {
      setError("연결에 실패했습니다. 잠시 후 다시 시도하세요.");
    }
    setBusy(false);
  }

  return (
    <form onSubmit={onSubmit} className="flex w-full flex-col gap-3">
      <label htmlFor="password" className="text-sm font-medium text-gray-700">
        비밀번호
      </label>
      <input
        id="password"
        type="password"
        autoComplete="current-password"
        autoFocus
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        disabled={!configured || busy}
        className="rounded border border-gray-300 px-3 py-2 text-base focus:border-blue-500 focus:outline-none disabled:bg-gray-100"
      />
      {error && (
        <p role="alert" className="text-sm text-red-600">
          {error}
        </p>
      )}
      <button
        type="submit"
        disabled={!configured || busy}
        className="rounded bg-blue-600 px-4 py-2 font-medium text-white hover:bg-blue-700 disabled:opacity-50"
      >
        {busy ? "확인 중…" : "입장"}
      </button>
    </form>
  );
}
