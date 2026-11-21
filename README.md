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

## Licencias

- Este proyecto: **AGPL-3.0-or-later** ([LICENSE](LICENSE)).
- ygopro-core y los scripts de cartas (CardScripts/DeltaBagooska) de Project Ignis: AGPL-3.0.
- `ocgcore-wasm`: MIT.
- Nombres y textos de las cartas: © Konami. La app no incluye ilustraciones de cartas.
