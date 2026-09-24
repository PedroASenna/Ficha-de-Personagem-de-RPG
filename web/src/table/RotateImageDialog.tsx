import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Dialog from "@mui/material/Dialog";
import DialogActions from "@mui/material/DialogActions";
import DialogContent from "@mui/material/DialogContent";
import DialogTitle from "@mui/material/DialogTitle";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import { useEffect, useState } from "react";

import { RotationControl } from "./RotationControl";

interface Props {
  files: File[];
  /** Retrato redondo: mostra o corte em círculo, como vai aparecer no boneco. */
  round?: boolean;
  confirmLabel?: string;
  busy?: boolean;
  onConfirm: (rotations: number[]) => void;
  onCancel: () => void;
}

function Preview({ file, rotation, round }: { file: File; rotation: number; round: boolean }) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    // Data URL em vez de createObjectURL: nada para liberar depois (e funciona com o StrictMode).
    const reader = new FileReader();
    reader.onload = () => setUrl(typeof reader.result === "string" ? reader.result : null);
    reader.readAsDataURL(file);
    return () => reader.abort();
  }, [file]);
  return (
    <Box
      sx={{
        width: round ? 160 : "100%",
        height: 160,
        mx: "auto",
        display: "grid",
        placeItems: "center",
        overflow: "hidden",
        borderRadius: round ? "50%" : 2,
        bgcolor: "rgba(0,0,0,0.35)",
        backgroundImage:
          "linear-gradient(45deg, rgba(255,255,255,0.04) 25%, transparent 25%, transparent 75%, rgba(255,255,255,0.04) 75%)",
        backgroundSize: "16px 16px",
      }}
    >
      {url && (
        <Box
          component="img"
          src={url}
          alt={file.name}
          sx={{
            maxWidth: round ? "none" : "70%",
            maxHeight: round ? "none" : "70%",
            width: round ? "100%" : "auto",
            height: round ? "100%" : "auto",
            objectFit: "cover",
            transform: `rotate(${rotation}deg)`,
            transition: "transform 120ms ease-out",
          }}
        />
      )}
    </Box>
  );
}

/** Antes de enviar: ajusta o ângulo de cada imagem (o servidor gira antes de gravar). */
export function RotateImageDialog({ files, round = false, confirmLabel, busy = false, onConfirm, onCancel }: Props) {
  const [rotations, setRotations] = useState<number[]>(() => files.map(() => 0));
  const many = files.length > 1;
  return (
    <Dialog open onClose={onCancel} fullWidth maxWidth={many ? "md" : "xs"}>
      <DialogTitle>{many ? `Ajustar o ângulo de ${files.length} imagens` : "Ajustar o ângulo da imagem"}</DialogTitle>
      <DialogContent>
        <Box
          sx={{
            display: "grid",
            gridTemplateColumns: many ? "repeat(auto-fill, minmax(220px, 1fr))" : "1fr",
            gap: 2,
            pt: 1,
          }}
        >
          {files.map((file, index) => (
            <Stack key={`${file.name}-${index}`} spacing={1}>
              <Preview file={file} rotation={rotations[index] ?? 0} round={round} />
              {many && (
                <Typography variant="caption" color="text.secondary" noWrap>
                  {file.name}
                </Typography>
              )}
              <RotationControl
                value={rotations[index] ?? 0}
                onChange={(degrees) => setRotations((all) => all.map((r, i) => (i === index ? degrees : r)))}
              />
            </Stack>
          ))}
        </Box>
      </DialogContent>
      <DialogActions>
        <Button onClick={onCancel}>Cancelar</Button>
        <Button variant="contained" loading={busy} onClick={() => onConfirm(rotations)}>
          {confirmLabel ?? (many ? `Enviar ${files.length} imagens` : "Enviar imagem")}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
