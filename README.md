# GOAT Online

Simulador de Yu-Gi-Oh! en formato **GOAT** (lista de abril de 2005) para jugar en el iPhone contra
otros usuarios. Ver [CLAUDE.md](CLAUDE.md) para la arquitectura y las fases.

## Fase 1: motor de reglas

- Motor: [ygopro-core de Project Ignis](https://github.com/edo9300/ygopro-core) (EDOPro) en WebAssembly vía
  [`ocgcore-wasm`](https://github.com/n1xx1/ocgcore-wasm).
- Datos: `npm run data` genera `data/goat/` (cartas, scripts Lua y límites del pool GOAT) desde una
  instalación de Project Ignis (`PROJECT_IGNIS`, por defecto `C:\ProjectIgnis`), aplicando las
  actualizaciones de DeltaBagooska.
- Prueba: `npm run test:duel -- 40` juega 40 duelos completos entre bots con los mazos `.ydk` legales
  en GOAT de `C:\ProjectIgnis\deck` y comprueba que el duelo es reproducible.

```powershell
npm install
npm run data
npm run test:duel -- 40
```

## Fase 2: servidor de duelos (árbitro)

`server/`: Worker de Cloudflare con un Durable Object por sala (`DuelRoom`) que ejecuta el motor.

- Cada jugador recibe solo lo que puede ver (`src/engine/visibility.ts`): nunca la mano, el mazo,
  el Extra Deck ni las cartas boca abajo del rival, ni en el tablero, ni en los eventos, ni en las
  opciones de una decisión.
- Los clientes solo mandan respuestas. El servidor comprueba su forma (`src/engine/validate.ts`)
  antes de dárselas al motor; las que no son legales se vuelven a pedir.
- Reconexión con el token del asiento. Si Cloudflare saca la sala de memoria, el duelo se
  reconstruye repitiendo las respuestas guardadas (el motor es determinista).
- Protocolo: `src/protocol.ts` (WebSocket `GET /api/duel/<sala>`, JSON con bigint vía `src/codec.ts`).

```powershell
npm run server:dev                                   # http://localhost:8788
node test/server-duel.ts ws://localhost:8788 20      # 20 duelos bot contra bot por el servidor
```

La prueba comprueba en cada actualización que no hay fugas de información, y en el primer duelo:
respuestas fuera de turno y mal formadas, reconexión y reconstrucción de la sala (con
`server/.dev.vars` = `DEBUG=1`).

## Licencias

- Este proyecto: **AGPL-3.0-or-later** ([LICENSE](LICENSE)).
- ygopro-core y los scripts de cartas (CardScripts/DeltaBagooska) de Project Ignis: AGPL-3.0.
- `ocgcore-wasm`: MIT.
- Nombres y textos de las cartas: © Konami. La app no incluye ilustraciones de cartas.
