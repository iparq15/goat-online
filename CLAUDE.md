# Proyecto: GOAT Online (PWA)

## Objetivo
Simulador de Yu-Gi-Oh! en **formato GOAT** (lista de abril de 2005) jugable en iPhone
como web app instalable (PWA), **contra otros usuarios por internet** mediante un lobby
público de salas. Tema visual **original** con aire retro de portátil de los 2000
(pixel art, paleta y tipografía), diseñado desde cero.

## Decisiones de arquitectura (no cambiar sin preguntar)
- Motor de reglas: ygopro-core de Project Ignis (EDOPro) en WebAssembly, vía el paquete
  `ocgcore-wasm` (envoltorio MIT; el core es AGPL-3.0).
- Datos: solo el cardpool GOAT. Se generan con un script a partir de Project Ignis
  (`C:\ProjectIgnis` en local, o sus repos públicos: CardScripts, BabelCDB, LFLists,
  DeltaBagooska): lista GOAT (`GOAT.lflist.conf`), cartas de las .cdb y scripts Lua.
- **Árbitro en el servidor**: el duelo corre en un Durable Object de Cloudflare. Cada
  jugador solo recibe la información que puede ver (mano rival, orden del mazo… nunca
  salen del servidor). Los clientes solo envían sus respuestas.
- Frontend: PWA pensada primero para Safari en iPhone, en vertical, táctil.
- Lobby: Cloudflare Workers + Durable Objects (reutilizando la idea de gba-link-online).

## Reglas
- **Sin ilustraciones de cartas.** Las cartas se muestran con un marco pixel art
  original: nombre, tipo, atributo, nivel, ATK/DEF y texto. No incluir, descargar ni
  enlazar arte de Konami.
- **No imitar el aspecto de ningún juego existente** (en particular los juegos de GBA de
  Konami): interfaz, tablero, sprites, sonidos y tipografía son diseño propio o de
  licencia libre (indicar la licencia de cada asset de terceros).
- **Licencia AGPL-3.0**: el repo es público y la app enlaza a su código fuente.
- Mazos guardados en el dispositivo (IndexedDB), con importación/exportación `.ydk`.
- iOS: el audio arranca tras el primer toque; si la app pasa a segundo plano, avisar al
  rival (el servidor mantiene el duelo y aplica un tiempo de espera razonable).
- Trabajar por fases. Al terminar cada fase: explicar cómo probarla, decir qué falta y
  esperar confirmación antes de pasar a la siguiente.

## Fases
1. Motor de reglas en WASM con solo el cardpool GOAT. Duelo completo automático (sin UI).
2. Servidor de duelos (Durable Object) como árbitro, con protocolo cliente-servidor.
3. Interfaz del duelo (tema retro original). Duelo contra uno mismo en el mismo móvil.
4. Editor de mazos limitado a GOAT, mazos locales e importación/exportación `.ydk`.
5. Online: lobby, duelo contra otros usuarios, reconexión y segundo plano.
6. Deploy y pulido para iPhone.
