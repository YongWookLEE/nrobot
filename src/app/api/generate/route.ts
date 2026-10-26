import { api } from "@/server/api";

// Cache Components는 기본 Node 런타임을 쓰며 runtime export를 허용하지 않는다.
export const maxDuration = 60;

export async function POST(request: Request) {
  return api.generate(request);
}
