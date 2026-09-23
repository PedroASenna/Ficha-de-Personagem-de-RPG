#!/usr/bin/env bash
# Gera o pacote .deb do servidor RPG Play: executável PyInstaller (Python embutido), painel do Mestre,
# serviço systemd e comando rpgplay-server.
#
#   packaging/server/build-deb.sh
#
# Variáveis opcionais:
#   PYTHON     Python usado no build. Use um Python "portátil" (ex.: `uv python find 3.12`) ou compile numa
#              distro antiga para o pacote rodar em sistemas com glibc mais velha (Debian 12, Raspberry Pi OS).
#   SKIP_WEB=1 não recompila o painel (usa web/dist existente).
#   OUT        pasta de saída (padrão: dist/ na raiz do repositório).
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
VERSION="$(sed -n 's/^version = "\(.*\)"/\1/p' "$ROOT/backend/pyproject.toml" | head -n 1)"
ARCH="$(dpkg --print-architecture)"
PYTHON="${PYTHON:-python3}"
BUILD="$HERE/build"
OUT="${OUT:-$ROOT/dist}"
PKG="$BUILD/pkg"

echo "==> RPG Play servidor $VERSION ($ARCH) com $("$PYTHON" --version)"

if [ "${SKIP_WEB:-0}" != 1 ]; then
  echo "==> Painel do Mestre (web/)"
  (cd "$ROOT/web" && npm ci --no-audit --no-fund && npm run build)
fi
test -f "$ROOT/web/dist/index.html" || { echo "web/dist não existe" >&2; exit 1; }

echo "==> Ambiente de build"
rm -rf "$BUILD"
"$PYTHON" -m venv "$BUILD/venv"
"$BUILD/venv/bin/pip" install --quiet --upgrade pip
"$BUILD/venv/bin/pip" install --quiet "$ROOT/backend[package]"

echo "==> PyInstaller"
"$BUILD/venv/bin/pyinstaller" --noconfirm --clean --log-level WARN \
  --distpath "$BUILD/pyi-dist" --workpath "$BUILD/pyi-work" "$HERE/rpgplay-server.spec"
BIN_DIR="$BUILD/pyi-dist/rpgplay-server"

echo "==> Conferindo o executável"
CHECK_DATA="$(mktemp -d)"
RPG_DATA_DIR="$CHECK_DATA" RPG_ENV=prod "$BIN_DIR/rpgplay-server" info
RPG_DATA_DIR="$CHECK_DATA" RPG_ENV=prod "$BIN_DIR/rpgplay-server" purge
rm -rf "$CHECK_DATA"

echo "==> Montando o pacote"
install -d -m 0755 "$PKG/DEBIAN" "$PKG/opt" "$PKG/usr/bin" "$PKG/usr/lib/systemd/system" \
  "$PKG/etc/rpgplay" "$PKG/usr/share/doc/rpgplay-server"
cp -a "$BIN_DIR" "$PKG/opt/rpgplay-server"
install -m 0755 "$HERE/rpgplay-server.wrapper" "$PKG/usr/bin/rpgplay-server"
install -m 0644 "$HERE/rpgplay-server.service" "$HERE/rpgplay-server-purge.service" \
  "$HERE/rpgplay-server-purge.timer" "$PKG/usr/lib/systemd/system/"
install -m 0644 "$HERE/server.env" "$PKG/etc/rpgplay/server.env"
install -m 0644 "$HERE/debian/README" "$HERE/debian/copyright" "$PKG/usr/share/doc/rpgplay-server/"
install -m 0755 "$HERE/debian/postinst" "$HERE/debian/prerm" "$HERE/debian/postrm" "$PKG/DEBIAN/"
install -m 0644 "$HERE/debian/conffiles" "$PKG/DEBIAN/conffiles"
find "$PKG/opt" -type d -exec chmod 0755 {} +
find "$PKG/opt" -type f -exec chmod go-w {} +
SIZE="$(du -sk --exclude=DEBIAN "$PKG" | cut -f1)"
sed -e "s/@VERSION@/$VERSION/" -e "s/@ARCH@/$ARCH/" -e "s/@SIZE@/$SIZE/" "$HERE/debian/control.in" > "$PKG/DEBIAN/control"

mkdir -p "$OUT"
DEB="$OUT/rpgplay-server_${VERSION}_${ARCH}.deb"
dpkg-deb --root-owner-group -Zxz --build "$PKG" "$DEB" >/dev/null
echo "==> $DEB ($(du -h "$DEB" | cut -f1))"

# glibc mínima exigida pelo executável e pelas bibliotecas embutidas.
GLIBC="$(find "$PKG/opt" -type f \( -name '*.so*' -o -name rpgplay-server \) -exec objdump -T {} + 2>/dev/null \
  | grep -o 'GLIBC_[0-9.]*' | sort -Vu | tail -n 1 || true)"
echo "==> Requer ${GLIBC:-glibc (não verificado)}"
