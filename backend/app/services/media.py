"""Imagens (retratos, mapas, peças de cenário, brasões): normalização e armazenamento (disco local ou GCS)."""

import asyncio
import io
import uuid
from dataclasses import dataclass
from datetime import timedelta
from pathlib import Path
from typing import Protocol

from PIL import Image, ImageOps, UnidentifiedImageError

from app.core.config import Settings

MAX_SOURCE_PIXELS = 40_000_000  # proteção contra "decompression bomb"
ALLOWED_FORMATS = {"JPEG", "PNG", "WEBP"}


class InvalidImageError(ValueError):
    pass


@dataclass(frozen=True)
class ProcessedImage:
    data: bytes
    width: int
    height: int
    content_type: str
    extension: str


# Espécies de imagem da mesa: lado máximo, se corta em quadrado e se mantém transparência (PNG).
ROOM_IMAGE_KINDS: dict[str, tuple[int, bool, bool]] = {
    "map": (4096, False, False),  # mapa de fundo da cena ou mapa-múndi
    "token": (512, True, False),  # retrato de inimigo (aparece redondo)
    "piece": (2048, False, True),  # peça de cenário / objeto (árvore, carroça...), com fundo transparente
    "emblem": (512, False, True),  # brasão/bandeira de nação ou facção
}
MAP_MAX_SIDE = 4096
MAP_FILL = (27, 21, 17)  # cantos que sobram ao girar um mapa (mesma cor do fundo da mesa)


def _open_checked(data: bytes, max_pixels: int) -> Image.Image:
    with Image.open(io.BytesIO(data)) as probe:
        if probe.format not in ALLOWED_FORMATS:
            raise InvalidImageError("Formato não suportado. Envie JPEG, PNG ou WebP.")
        if probe.width * probe.height > max_pixels:
            raise InvalidImageError("Imagem grande demais.")
        probe.verify()
    img = Image.open(io.BytesIO(data))
    return ImageOps.exif_transpose(img)


def _has_alpha(img: Image.Image) -> bool:
    if img.mode in ("RGBA", "LA") or (img.mode == "P" and "transparency" in img.info):
        alpha = img.convert("RGBA").getchannel("A")
        return alpha.getextrema()[0] < 255
    return False


def _rotate(img: Image.Image, degrees: float, *, expand: bool, fill: tuple[int, ...]) -> Image.Image:
    """Gira no sentido horário. Múltiplos de 90° são exatos (sem cantos preenchidos)."""
    degrees = degrees % 360
    if degrees == 0:
        return img
    exact = {90: Image.Transpose.ROTATE_270, 180: Image.Transpose.ROTATE_180, 270: Image.Transpose.ROTATE_90}
    if degrees in exact:
        return img.transpose(exact[int(degrees)])
    return img.rotate(-degrees, resample=Image.Resampling.BICUBIC, expand=expand, fillcolor=fill)


def _encode(img: Image.Image, keep_alpha: bool) -> ProcessedImage:
    out = io.BytesIO()
    if keep_alpha:
        img.save(out, format="PNG", optimize=True)
        return ProcessedImage(out.getvalue(), img.width, img.height, "image/png", "png")
    img.convert("RGB").save(out, format="JPEG", quality=85, optimize=True)
    return ProcessedImage(out.getvalue(), img.width, img.height, "image/jpeg", "jpg")


def process_image(data: bytes, kind: str, rotation: float = 0.0) -> ProcessedImage:
    """Valida, gira (se pedido), reduz e reencoda. O reencode descarta todo metadado (EXIF com GPS etc.).

    Retratos giram em torno do centro sem aumentar a imagem: o círculo em que aparecem fica sempre
    coberto. Mapas e peças crescem para caber inteiros; os cantos ficam transparentes nas peças.
    """
    max_side, square, transparent = ROOM_IMAGE_KINDS[kind]
    try:
        img = _open_checked(data, MAX_SOURCE_PIXELS * (2 if kind == "map" else 1))
        keep_alpha = transparent and (_has_alpha(img) or (rotation % 90 != 0))
        img = img.convert("RGBA" if keep_alpha else "RGB")
        if square:
            img = _rotate(img, rotation, expand=False, fill=(42, 34, 28))
            img = ImageOps.fit(img, (max_side, max_side), method=Image.Resampling.LANCZOS)
        else:
            img = _rotate(img, rotation, expand=True, fill=(0, 0, 0, 0) if keep_alpha else MAP_FILL)
            img.thumbnail((max_side, max_side), Image.Resampling.LANCZOS)
        return _encode(img, keep_alpha)
    except (UnidentifiedImageError, OSError, Image.DecompressionBombError) as exc:
        raise InvalidImageError("Arquivo de imagem inválido.") from exc


def process_portrait(data: bytes, rotation: float = 0.0) -> bytes:
    """Retrato de personagem: quadrado 512x512 em JPEG, sem metadados."""
    return process_image(data, "token", rotation).data


def process_map(data: bytes, rotation: float = 0.0) -> tuple[bytes, int, int]:
    """Mapa: mantém a proporção, lado maior até 4096 px, JPEG sem EXIF."""
    image = process_image(data, "map", rotation)
    return image.data, image.width, image.height


def new_room_media_key(room_id: uuid.UUID, kind: str, extension: str = "jpg") -> str:
    return f"rooms/{room_id}/{kind}/{uuid.uuid4().hex}.{extension}"


def new_portrait_key(user_id: uuid.UUID) -> str:
    return f"portraits/{user_id}/{uuid.uuid4().hex}.jpg"


class MediaStore(Protocol):
    async def put(self, key: str, data: bytes, content_type: str) -> None: ...

    async def delete(self, key: str) -> None: ...

    def url(self, key: str) -> str: ...


class LocalMediaStore:
    def __init__(self, root: str, base_url: str = "/media") -> None:
        self.root = Path(root)
        self.base_url = base_url

    def _path(self, key: str) -> Path:
        path = (self.root / key).resolve()
        if not path.is_relative_to(self.root.resolve()):
            raise ValueError("chave inválida")
        return path

    async def put(self, key: str, data: bytes, content_type: str) -> None:
        path = self._path(key)
        path.parent.mkdir(parents=True, exist_ok=True)
        await asyncio.to_thread(path.write_bytes, data)

    async def delete(self, key: str) -> None:
        self._path(key).unlink(missing_ok=True)

    def url(self, key: str) -> str:
        return f"{self.base_url}/{key}"


class GcsMediaStore:
    """Bucket privado; leitura por URL assinada V4 de curta duração."""

    def __init__(self, bucket: str) -> None:
        from google.cloud import storage  # dependência opcional: pip install .[gcp]

        self._bucket = storage.Client().bucket(bucket)

    async def put(self, key: str, data: bytes, content_type: str) -> None:
        blob = self._bucket.blob(key)
        blob.cache_control = "private, max-age=3600"
        await asyncio.to_thread(blob.upload_from_string, data, content_type=content_type)

    async def delete(self, key: str) -> None:
        from google.api_core.exceptions import NotFound

        try:
            await asyncio.to_thread(self._bucket.blob(key).delete)
        except NotFound:
            pass

    def url(self, key: str) -> str:
        return self._bucket.blob(key).generate_signed_url(version="v4", expiration=timedelta(hours=1), method="GET")


def build_media_store(settings: Settings) -> MediaStore:
    if settings.media_backend == "gcs":
        return GcsMediaStore(settings.gcs_bucket or "")
    return LocalMediaStore(str(settings.media_path))
