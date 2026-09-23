"""Retratos de personagem: normalização da imagem e armazenamento (disco local em dev, GCS em produção)."""

import asyncio
import io
import uuid
from datetime import timedelta
from pathlib import Path
from typing import Protocol

from PIL import Image, ImageOps, UnidentifiedImageError

from app.core.config import Settings

PORTRAIT_SIZE = (512, 512)
MAX_SOURCE_PIXELS = 40_000_000  # proteção contra "decompression bomb"
ALLOWED_FORMATS = {"JPEG", "PNG", "WEBP"}


class InvalidImageError(ValueError):
    pass


def process_portrait(data: bytes) -> bytes:
    """Valida, corta em quadrado 512x512 e reencoda em JPEG.

    O reencode descarta todos os metadados (EXIF com GPS, modelo do celular etc.): minimização de dados.
    """
    try:
        with Image.open(io.BytesIO(data)) as probe:
            if probe.format not in ALLOWED_FORMATS:
                raise InvalidImageError("Formato não suportado. Envie JPEG, PNG ou WebP.")
            if probe.width * probe.height > MAX_SOURCE_PIXELS:
                raise InvalidImageError("Imagem grande demais.")
            probe.verify()
        with Image.open(io.BytesIO(data)) as img:
            img = ImageOps.exif_transpose(img)
            img = img.convert("RGB")
            img = ImageOps.fit(img, PORTRAIT_SIZE, method=Image.Resampling.LANCZOS)
            out = io.BytesIO()
            img.save(out, format="JPEG", quality=85, optimize=True)
            return out.getvalue()
    except (UnidentifiedImageError, OSError, Image.DecompressionBombError) as exc:
        raise InvalidImageError("Arquivo de imagem inválido.") from exc


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
    return LocalMediaStore(settings.media_local_dir)
