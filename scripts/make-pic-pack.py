"""Pack de ilustraciones pixeladas para uso personal (NO se incluye en el repo ni en el deploy).

Lee las imágenes que EDOPro ya descargó en tu instalación de Project Ignis (pics/<código>.jpg),
recorta la ilustración, la reduce a 48x48 con una paleta corta (aspecto pixel) y crea un .zip
con un PNG por carta del pool GOAT (<código raíz>.png). Ese .zip se importa en la app desde
Settings → Card pictures, y se guarda solo en el dispositivo.

    python scripts/make-pic-pack.py [salida.zip]

Por defecto: %USERPROFILE%/OneDrive/Documentos/goat-card-pack/goat-pics.zip (fuera del repo).
Las cartas sin imagen en pics/ siguen con su icono pixel; abre esas cartas en EDOPro para que las
descargue y vuelve a ejecutar el script.
"""

import io
import json
import os
import sys
import zipfile

from PIL import Image, ImageEnhance

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
IGNIS = os.environ.get('PROJECT_IGNIS', 'C:/ProjectIgnis')
PICS = os.path.join(IGNIS, 'pics')
SIZE = 48
COLORS = 48
OUT = sys.argv[1] if len(sys.argv) > 1 else os.path.join(
    os.path.expanduser('~'), 'OneDrive', 'Documentos', 'goat-card-pack', 'goat-pics.zip')

# El pack nunca debe acabar dentro del proyecto (se publicaría).
if os.path.abspath(OUT).startswith(ROOT + os.sep):
    sys.exit('La salida no puede estar dentro del proyecto: el repo y el deploy son públicos.')


def pixelate(path: str) -> bytes:
    im = Image.open(path).convert('RGB')
    w, h = im.size
    # Ventana de la ilustración en una carta estándar (proporciones de la carta).
    top = round(h * 0.183)
    side = round(w * 0.76)
    art = im.crop((round(w * 0.12), top, round(w * 0.12) + side, top + side))
    art = ImageEnhance.Contrast(art).enhance(1.12)
    art = ImageEnhance.Color(art).enhance(1.18)
    small = art.resize((SIZE, SIZE), Image.BOX)
    small = small.quantize(colors=COLORS, method=Image.Quantize.MEDIANCUT, dither=Image.Dither.NONE)
    buf = io.BytesIO()
    small.save(buf, 'PNG', optimize=True)
    return buf.getvalue()


def main() -> None:
    cards = json.load(open(os.path.join(ROOT, 'data', 'goat', 'cards.json'), encoding='utf8'))
    pool: dict[int, list[int]] = {}
    for c in cards:
        if c['inPool']:
            pool.setdefault(c['alias'] or c['code'], []).append(c['code'])
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    done = missing = 0
    total = 0
    # Sin compresión: los PNG ya están comprimidos y así la app los lee sin descomprimir.
    with zipfile.ZipFile(OUT, 'w', zipfile.ZIP_STORED) as z:
        for root, codes in sorted(pool.items()):
            src = next((os.path.join(PICS, f'{c}.jpg') for c in [root, *codes] if os.path.exists(os.path.join(PICS, f'{c}.jpg'))), None)
            if not src:
                missing += 1
                continue
            data = pixelate(src)
            z.writestr(f'{root}.png', data)
            total += len(data)
            done += 1
    print(f'{done} ilustraciones ({total / 1024 / 1024:.1f} MB) · {missing} cartas sin imagen en {PICS}')
    print(f'Pack: {OUT} ({os.path.getsize(OUT) / 1024 / 1024:.1f} MB)')


if __name__ == '__main__':
    main()
