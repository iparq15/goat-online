// /api/* -> Worker de GOAT Online (WebSocket incluido) por service binding.
interface Env {
  API: { fetch(req: Request): Promise<Response> };
}

export const onRequest = ({ request, env }: { request: Request; env: Env }): Promise<Response> => env.API.fetch(request);
