import { api } from "@/server/api";

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  return api.catalogImage(request, id);
}
