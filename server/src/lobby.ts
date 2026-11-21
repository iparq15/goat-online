// Durable Object del lobby: salas creadas que esperan rival. Las públicas se listan; las
// privadas solo se encuentran con su código. Una sala sale del lobby cuando empieza el duelo
// o cuando su creador se va.

import { DurableObject } from 'cloudflare:workers';
import type { RoomInfo } from '../../src/protocol.ts';

/** Sin letras que se confunden (0/O, 1/I/L). */
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const CODE_LEN = 5;
/** Una sala sin rival desaparece del lobby a los 30 minutos. */
const ROOM_TTL = 30 * 60 * 1000;

export const ROOM_CODE = new RegExp(`^[${ALPHABET}]{${CODE_LEN}}$`);

interface Room extends RoomInfo {
  public: boolean;
}

export class Lobby extends DurableObject {
  private rooms: Map<string, Room> | null = null;

  private async load(): Promise<Map<string, Room>> {
    if (!this.rooms) {
      const stored = (await this.ctx.storage.get<Room[]>('rooms')) ?? [];
      this.rooms = new Map(stored.map((r) => [r.id, r]));
    }
    const now = Date.now();
    for (const [id, r] of this.rooms) if (now - r.created > ROOM_TTL) this.rooms.delete(id);
    return this.rooms;
  }

  private async persist(): Promise<void> {
    await this.ctx.storage.put('rooms', [...(this.rooms?.values() ?? [])]);
  }

  async create(host: string, isPublic: boolean): Promise<string> {
    const rooms = await this.load();
    let id = '';
    do {
      const rnd = crypto.getRandomValues(new Uint8Array(CODE_LEN));
      id = [...rnd].map((b) => ALPHABET[b % ALPHABET.length]).join('');
    } while (rooms.has(id));
    rooms.set(id, { id, host: host.trim().slice(0, 24) || 'Player', created: Date.now(), public: isPublic });
    await this.persist();
    return id;
  }

  async list(): Promise<RoomInfo[]> {
    const rooms = await this.load();
    return [...rooms.values()]
      .filter((r) => r.public)
      .sort((a, b) => b.created - a.created)
      .slice(0, 50)
      .map(({ id, host, created }) => ({ id, host, created }));
  }

  async get(id: string): Promise<RoomInfo | null> {
    const r = (await this.load()).get(id);
    return r ? { id: r.id, host: r.host, created: r.created } : null;
  }

  async remove(id: string): Promise<void> {
    const rooms = await this.load();
    if (rooms.delete(id)) await this.persist();
  }
}
