// Worker de GOAT Online (Fase 2): servidor de duelos.
//   GET /api/health          -> "ok"
//   GET /api/duel/<sala>     -> WebSocket con el árbitro de esa sala (Durable Object)

export { DuelRoom } from './duel-room.ts';
import type { Env } from './duel-room.ts';

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);
    if (url.pathname === '/api/health') return new Response('ok');
    const m = url.pathname.match(/^\/api\/duel\/([A-Za-z0-9_-]{1,64})$/);
    if (m) {
      const stub = env.DUEL_ROOM.get(env.DUEL_ROOM.idFromName(m[1]));
      return stub.fetch(req);
    }
    return new Response('Not found', { status: 404 });
  },
} satisfies ExportedHandler<Env>;
