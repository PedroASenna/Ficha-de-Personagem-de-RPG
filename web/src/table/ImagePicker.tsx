import ImageIcon from "@mui/icons-material/AddPhotoAlternateOutlined";
import Box from "@mui/material/Box";
import CircularProgress from "@mui/material/CircularProgress";
import Typography from "@mui/material/Typography";
import { type ChangeEvent, type DragEvent, useId, useState } from "react";

import type { ImageUpload } from "../api/types";
import { toast } from "../toasts";
import { type ImageKind, uploadImage } from "./actions";
import { RotateImageDialog } from "./RotateImageDialog";

interface Props {
  roomId: string;
  kind: ImageKind;
  previewUrl: string | null;
  onUploaded: (image: ImageUpload) => void;
  label: string;
  round?: boolean;
}

/**
 * Área para soltar/escolher imagem. Antes de enviar abre o ajuste de ângulo; depois devolve a chave
 * para salvar na cena, no inimigo, no objeto ou na facção.
 */
export function ImagePicker({ roomId, kind, previewUrl, onUploaded, label, round = false }: Props) {
  const inputId = useId();
  const [busy, setBusy] = useState(false);
  const [over, setOver] = useState(false);
  const [pending, setPending] = useState<File | null>(null);

  const choose = (file: File | undefined) => {
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      toast.error("Escolha um arquivo de imagem (PNG, JPG, WEBP…).");
      return;
    }
    setPending(file);
  };

  const upload = async (file: File, rotation: number) => {
    setBusy(true);
    try {
      onUploaded(await uploadImage(roomId, kind, file, rotation));
      setPending(null);
    } catch (error) {
      toast.error(error);
    } finally {
      setBusy(false);
    }
  };

  const wide = kind === "map" || kind === "piece";
  const size = wide ? { width: "100%", height: 180 } : { width: 120, height: 120 };
  return (
    <>
      <Box
        component="label"
        htmlFor={inputId}
        onDragOver={(e: DragEvent) => {
          e.preventDefault();
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(e: DragEvent) => {
          e.preventDefault();
          setOver(false);
          choose(e.dataTransfer.files[0]);
        }}
        sx={{
          ...size,
          flexShrink: 0,
          display: "grid",
          placeItems: "center",
          cursor: "pointer",
          borderRadius: round ? "50%" : 2,
          border: 2,
          borderStyle: "dashed",
          borderColor: over ? "primary.main" : "divider",
          backgroundColor: "rgba(0,0,0,0.25)",
          backgroundImage: previewUrl ? `url("${previewUrl}")` : undefined,
          backgroundSize: wide || kind === "emblem" ? "contain" : "cover",
          backgroundRepeat: "no-repeat",
          backgroundPosition: "center",
          overflow: "hidden",
        }}
      >
        <input
          id={inputId}
          type="file"
          accept="image/*"
          hidden
          data-testid={`upload-${kind}`}
          onChange={(e: ChangeEvent<HTMLInputElement>) => {
            choose(e.target.files?.[0]);
            e.target.value = "";
          }}
        />
        {busy ? (
          <CircularProgress size={28} />
        ) : (
          !previewUrl && (
            <Box sx={{ textAlign: "center", color: "text.secondary", p: 1 }}>
              <ImageIcon />
              <Typography variant="caption" sx={{ display: "block" }}>
                {label}
              </Typography>
            </Box>
          )
        )}
      </Box>
      {pending && (
        <RotateImageDialog
          files={[pending]}
          round={round}
          busy={busy}
          onCancel={() => setPending(null)}
          onConfirm={([rotation]) => void upload(pending, rotation ?? 0)}
        />
      )}
    </>
  );
}
