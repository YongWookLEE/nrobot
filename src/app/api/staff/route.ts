import { api } from "@/server/api";

export async function GET(request: Request) {
  return api.staff(request);
}
