import { handleEnter } from "@/auth/enter";

export async function POST(request: Request) {
  return handleEnter(request);
}
