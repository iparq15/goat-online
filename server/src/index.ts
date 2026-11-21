// Worker de GOAT Online: lobby y servidor de duelos.
//   GET  /api/health          -> "ok"
//   GET  /api/rooms           -> salas públicas que esperan rival (RoomInfo[])
//   POST /api/rooms           -> crea una sala {host, public} -> {id}
//   GET  /api/rooms/<código>  -> RoomInfo (404 si no existe o ya empezó)
//   GET  /api/duel/<código>   -> WebSocket con el árbitro de esa sala (Durable Object)

export { DuelRoom } from './duel-room.ts';
export { Lobby } from './lobby.ts';
import type { Env } from './duel-room.ts';
import { ROOM_CODE } from './lobby.ts';

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);
    const path = url.pathname;
    const lobby = () => env.LOBBY.get(env.LOBBY.idFromName('main'));

    if (path === '/api/health') return new Response('ok');

    if (path === '/api/rooms') {
      if (req.method === 'GET') return json(await lobby().list());
      if (req.method === 'POST') {
        let body: { host?: unknown; public?: unknown } = {};
        try {
          body = (await req.json()) as typeof body;
        } catch {
          /* cuerpo vacío */
        }
        const id = await lobby().create(String(body.host ?? ''), body.public !== false);
        return json({ id });
      }
      return json({ error: 'Method not allowed' }, 405);
    }

    let m = path.match(/^\/api\/rooms\/([A-Za-z0-9]{5})$/);
    if (m) {
      const room = await lobby().get(m[1].toUpperCase());
      return room ? json(room) : json({ error: 'Room not found' }, 404);
    }

    m = path.match(/^\/api\/duel\/([A-Za-z0-9]{5})$/);
    if (m) {
      const id = m[1].toUpperCase();
      if (!ROOM_CODE.test(id)) return json({ error: 'Invalid room code' }, 400);
      const stub = env.DUEL_ROOM.get(env.DUEL_ROOM.idFromName(id));
      const fwd = new Request(req);
      fwd.headers.set('X-Room-Id', id);
      return stub.fetch(fwd);
    }

    return json({ error: 'Not found' }, 404);
  },
} satisfies ExportedHandler<Env>;
