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

## Fase 3: interfaz del duelo (práctica en el mismo móvil)

App web (Vite, TypeScript sin framework) con un tema propio de aire retro: pixel art, paleta
limitada y fuentes de mapa de bits (Press Start 2P y Pixelify Sans, licencia OFL).

- Las cartas no llevan ilustración: un marco por tipo de carta y un emblema pixel generado a partir
  del código de cada carta (`src/ui/card-view.ts`).
- El árbitro (`src/engine/arbiter.ts`) es el mismo para el servidor y para el duelo local, así que
  la pantalla de duelo (`src/ui/duel-client.ts`) recibe exactamente los mismos mensajes en los dos
  modos.
- Duelo de práctica: los dos jugadores en el mismo móvil. La pantalla gira hacia quien tiene que
  decidir; opcionalmente se tapa al cambiar de jugador.
- Mazos de inicio legales en GOAT (`src/ui/starter-decks.ts`, comprobados con
  `node scripts/check-starters.ts`) e importación de `.ydk`.
- La interfaz está en inglés (textos del sistema de `config/strings.conf` de EDOPro; textos de las
  cartas, en inglés).

```powershell
npm run dev        # http://localhost:5180 (también desde el móvil en la misma red)
npm run build      # dist/
```

## Fase 4: editor de mazos

- "My decks": crear, copiar, borrar, importar (varios `.ydk` a la vez) y exportar `.ydk` (en el
  móvil abre el menú de compartir para guardarlo en Archivos). Los mazos de inicio se pueden copiar.
- Los mazos se guardan en IndexedDB (`src/ui/deck-store.ts`), con localStorage de respaldo.
- Editor limitado al pool GOAT: búsqueda por nombre (o texto), filtros por tipo, atributo y nivel,
  límites de la lista (prohibida, limitada, semilimitada) y avisos de legalidad en vivo.
- Las versiones de una misma carta (GOAT, pre-errata, arte alternativo) cuentan juntas para el
  límite (`src/engine/ydk.ts`).
- Al importar, las cartas con su código normal se cambian por su versión GOAT
  (`normalizeDeck`), así funcionan los `.ydk` hechos en otros simuladores.
- El duelo de práctica solo deja elegir mazos legales.

## Fase 5: duelos online

**App publicada:** https://goat-online.pages.dev

- Lobby (`server/src/lobby.ts`, Durable Object): salas públicas listadas y salas privadas con
  código de 5 caracteres; enlace de invitación `?room=CODE`.
- La sala de duelo avisa al lobby al empezar o al quedarse vacía, guarda sus plazas aunque
  Cloudflare la saque de memoria y borra sus datos una hora después de terminar.
- Reconexión automática con el token del asiento (también al volver de segundo plano en iOS) y
  "Resume online duel" en el menú si se cierra la app a mitad de duelo.
- Si la app pasa a segundo plano, el rival lo ve ("switched apps"). Si un jugador se desconecta y
  no vuelve en 3 minutos, pierde (alarma del Durable Object).
- Despliegue: Worker `goat-online` (lobby + duelos) y Cloudflare Pages, que reenvía `/api/*` al
  Worker por service binding (`pages/`).

```powershell
npm run server:dev                                   # http://localhost:8788
npm run dev                                          # http://localhost:5180 (proxy /api al 8788)
node test/server-duel.ts ws://localhost:8788 20      # incluye lobby, "away" y derrota por desconexión
npm run deploy                                       # Worker + Pages
```

Con `server/.dev.vars` = `DEBUG=1`, la derrota por desconexión es a los 6 s para poder probarla.

## Fase 6: app instalable y pulido para iPhone

- PWA: `public/manifest.webmanifest`, iconos pixel propios (`node scripts/gen-icons.mjs`) y service
  worker (`public/sw.js`). Al compilar, `vite.config.ts` le añade la lista de archivos de la app,
  así que tras la primera visita la app abre y el duelo de práctica funciona **sin conexión**.
  Cuando hay una versión nueva, el menú ofrece actualizar (nunca en mitad de un duelo).
- En iPhone: Compartir → "Añadir a pantalla de inicio" (la app lo sugiere en Safari).
- La pantalla no se apaga durante un duelo (Screen Wake Lock).
- Efectos de sonido sintetizados (sin archivos de audio); se activan con el primer toque (iOS) y se
  pausan en segundo plano.
- Ajustes (`src/ui/settings.ts`): sonido, elegir zona automáticamente y avisos de cadena
  "inteligentes" (no pregunta en simples cambios de fase, salvo en la fase de batalla y la fase
  final del rival). También desde el menú ☰ del duelo.

## Después de la Fase 6

- **Barajado inicial:** el motor de EDOPro no baraja el mazo al empezar (lo hace el cliente), así
  que `GoatDuel` lo baraja con un generador derivado de la semilla del duelo (reproducible).
- **Ilustraciones pixel propias** (diseño propio, no se usa el arte oficial):
  - Las **200 cartas más jugadas** de GOAT (Scapegoat, Pot of Greed, Mirror Force, Jinzo, los
    Monarcas, los LV con su nivel…) tienen un icono 16x16 dibujado a mano que representa su nombre o
    su efecto (`src/ui/card-sprites*.ts`).
  - El resto lleva un **logo genérico de su clase** (`src/ui/sprites.ts`): monstruo normal, de
    efecto (estrella), ritual (llama) y de fusión (espiral), coloreado con su atributo; magia normal,
    rápida, continua, de equipo, de campo y ritual; trampa normal, continua y de contraefecto; token.
  - Todos sobre un emblema tenue único de cada carta.
- **Nombres completos:** las cartas pequeñas muestran el nombre entero con una fuente pixel
  condensada (Jersey 10) en el tamaño que hace falta: `nameFit()` mide cada palabra y elige uno
  de cinco tamaños (comprobado con los 1698 nombres del pool en cartas de 48 a 60 px).
- **Animaciones** (`src/ui/fx.ts`, diseño propio): activar (carta grande con rayos), ataque
  (embestida y corte), destrucción (fragmentos pixel), salida del campo hacia mano/mazo/desterradas,
  invocación normal/especial/volteo, colocar, robar, barajar, daño (sacudida y LP que bajan),
  negación y cambio de turno. Velocidad normal/rápida/sin animaciones en Settings.

## Licencias

- Este proyecto: **AGPL-3.0-or-later** ([LICENSE](LICENSE)).
- ygopro-core y los scripts de cartas (CardScripts/DeltaBagooska) de Project Ignis: AGPL-3.0.
- `ocgcore-wasm`: MIT.
- Textos del sistema (`config/strings.conf` de EDOPro): Project Ignis.
- Fuentes Press Start 2P, Pixelify Sans y Jersey 10: SIL Open Font License.
- Nombres y textos de las cartas: © Konami. La app no incluye ilustraciones de cartas.
