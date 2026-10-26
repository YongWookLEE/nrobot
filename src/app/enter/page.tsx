import type { Metadata } from "next";
import { connection } from "next/server";
import { Suspense } from "react";
import { EnterForm } from "./EnterForm";

export const metadata: Metadata = {
  title: "입장 - 앤로보틱스 견적서",
};

async function EnterFormWithConfig() {
  // 비밀번호 설정 여부는 요청 시점 환경변수로 판단한다(빌드 시점 값으로 굳지 않도록).
  await connection();
  const configured = Boolean(process.env.APP_PASSWORD);
  return <EnterForm configured={configured} />;
}

export default function EnterPage() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-gray-50 px-4">
      <div className="flex w-full max-w-sm flex-col items-center gap-6 rounded-lg bg-white p-8 shadow">
        <h1 className="text-2xl font-bold text-gray-900">앤로보틱스 견적서</h1>
        <Suspense fallback={<EnterForm configured={true} />}>
          <EnterFormWithConfig />
        </Suspense>
      </div>
    </main>
  );
}
