import { handleLeave } from "@/auth/enter";

export async function POST(request: Request) {
  return handleLeave(request);
}
