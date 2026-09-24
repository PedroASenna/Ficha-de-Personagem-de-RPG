import RotateLeftIcon from "@mui/icons-material/RotateLeft";
import RotateRightIcon from "@mui/icons-material/RotateRight";
import IconButton from "@mui/material/IconButton";
import Slider from "@mui/material/Slider";
import Stack from "@mui/material/Stack";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";

import { normalizeAngle } from "./geometry";

interface Props {
  value: number;
  /** Chamado ao arrastar (pré-visualização). */
  onChange: (degrees: number) => void;
  /** Chamado ao soltar o controle ou girar 90° (hora de salvar). */
  onCommit?: (degrees: number) => void;
  label?: string;
}

/** Ângulo de uma imagem: botões de 90° e ajuste fino de -180° a 180°. */
export function RotationControl({ value, onChange, onCommit, label = "Ângulo" }: Props) {
  const turn = (delta: number) => {
    const next = normalizeAngle(value + delta);
    onChange(next);
    onCommit?.(next);
  };
  return (
    <Stack direction="row" spacing={1} sx={{ alignItems: "center" }}>
      <Tooltip title="Girar 90° para a esquerda">
        <IconButton size="small" aria-label="Girar 90° para a esquerda" onClick={() => turn(-90)}>
          <RotateLeftIcon fontSize="small" />
        </IconButton>
      </Tooltip>
      <Slider
        size="small"
        min={-180}
        max={180}
        step={1}
        value={normalizeAngle(value)}
        onChange={(_, v) => onChange(v as number)}
        onChangeCommitted={(_, v) => onCommit?.(v as number)}
        marks={[{ value: -90 }, { value: 0 }, { value: 90 }]}
        aria-label={label}
        sx={{ flex: 1, minWidth: 80 }}
      />
      <Tooltip title="Girar 90° para a direita">
        <IconButton size="small" aria-label="Girar 90° para a direita" onClick={() => turn(90)}>
          <RotateRightIcon fontSize="small" />
        </IconButton>
      </Tooltip>
      <Typography variant="body2" sx={{ width: 44, textAlign: "right" }} data-testid="rotation-value">
        {Math.round(normalizeAngle(value))}°
      </Typography>
    </Stack>
  );
}
