import ImageIcon from "@mui/icons-material/AddPhotoAlternateOutlined";
import Box from "@mui/material/Box";
import CircularProgress from "@mui/material/CircularProgress";
import Typography from "@mui/material/Typography";
import { type ChangeEvent, type DragEvent, useId, useState } from "react";

import type { ImageUpload } from "../api/types";
import { toast } from "../toasts";
import { uploadImage } from "./actions";

interface Props {
  roomId: string;
  kind: "map" | "token";
  previewUrl: string | null;
  onUploaded: (image: ImageUpload) => void;
  label: string;
  round?: boolean;
}

/** Área para soltar/escolher imagem: envia na hora e devolve a chave para salvar na cena ou no inimigo. */
export function ImagePicker({ roomId, kind, previewUrl, onUploaded, label, round = false }: Props) {
  const inputId = useId();
  const [busy, setBusy] = useState(false);
  const [over, setOver] = useState(false);

  const upload = async (file: File | undefined) => {
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      toast.error("Escolha um arquivo de imagem (PNG, JPG, WEBP…).");
      return;
    }
    setBusy(true);
    try {
      onUploaded(await uploadImage(roomId, kind, file));
    } catch (error) {
      toast.error(error);
    } finally {
      setBusy(false);
    }
  };

  const size = kind === "map" ? { width: "100%", height: 180 } : { width: 120, height: 120 };
  return (
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
        void upload(e.dataTransfer.files[0]);
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
        backgroundSize: kind === "map" ? "contain" : "cover",
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
        onChange={(e: ChangeEvent<HTMLInputElement>) => void upload(e.target.files?.[0])}
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
  );
}
