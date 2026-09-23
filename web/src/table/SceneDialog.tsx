import Button from "@mui/material/Button";
import Dialog from "@mui/material/Dialog";
import DialogActions from "@mui/material/DialogActions";
import DialogContent from "@mui/material/DialogContent";
import DialogTitle from "@mui/material/DialogTitle";
import FormControlLabel from "@mui/material/FormControlLabel";
import Slider from "@mui/material/Slider";
import Stack from "@mui/material/Stack";
import Switch from "@mui/material/Switch";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import { type FormEvent, useState } from "react";

import type { Scene } from "../api/types";
import { createScene, deleteScene, updateScene } from "./actions";
import { ImagePicker } from "./ImagePicker";

interface Props {
  roomId: string;
  scene: Scene | null; // null = nova cena
  onClose: () => void;
}

function SceneForm({ roomId, scene, onClose }: Props) {
  const [name, setName] = useState(scene?.name ?? "");
  const [map, setMap] = useState(
    scene?.map_key
      ? { key: scene.map_key, url: scene.map_url, width: scene.map_width, height: scene.map_height }
      : null,
  );
  const [grid, setGrid] = useState(scene?.grid_size ?? 70);
  const [gridVisible, setGridVisible] = useState(scene?.grid_visible ?? true);
  const [busy, setBusy] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    const body = {
      name: name.trim(),
      grid_size: grid,
      grid_visible: gridVisible,
      ...(map ? { map_key: map.key, map_width: map.width, map_height: map.height } : {}),
    };
    const saved = scene ? await updateScene(scene.id, body) : await createScene(roomId, body);
    setBusy(false);
    if (saved) onClose();
  };

  const remove = async () => {
    if (!scene || !window.confirm(`Apagar a cena "${scene.name}"? Os bonecos dela saem do mapa.`)) return;
    await deleteScene(scene.id);
    onClose();
  };

  return (
    <form onSubmit={(e) => void submit(e)}>
      <DialogTitle>{scene ? "Editar cena" : "Nova cena"}</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ pt: 1 }}>
          <TextField
            label="Nome da cena"
            placeholder="Taverna, Floresta, Caverna…"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            autoFocus
            slotProps={{ htmlInput: { maxLength: 60 } }}
          />
          <ImagePicker
            roomId={roomId}
            kind="map"
            label="Solte a imagem do mapa aqui ou clique para escolher (até 20 MB)"
            previewUrl={map?.url ?? null}
            onUploaded={(image) => setMap(image)}
          />
          {map && (
            <Typography variant="caption" color="text.secondary">
              Mapa {map.width} × {map.height} px ≈ {Math.round(map.width / grid)} × {Math.round(map.height / grid)}{" "}
              casas
            </Typography>
          )}
          <div>
            <Typography gutterBottom>Tamanho da casa da grade: {grid} px</Typography>
            <Slider
              value={grid}
              min={20}
              max={200}
              step={1}
              onChange={(_, value) => setGrid(value as number)}
              aria-label="Tamanho da grade"
            />
            <Typography variant="caption" color="text.secondary">
              Ajuste até a grade bater com os quadradinhos desenhados no mapa. Bonecos se encaixam nela.
            </Typography>
          </div>
          <FormControlLabel
            control={<Switch checked={gridVisible} onChange={(e) => setGridVisible(e.target.checked)} />}
            label="Mostrar grade"
          />
        </Stack>
      </DialogContent>
      <DialogActions>
        {scene && (
          <Button color="error" onClick={() => void remove()} sx={{ mr: "auto" }}>
            Apagar cena
          </Button>
        )}
        <Button onClick={onClose}>Cancelar</Button>
        <Button type="submit" variant="contained" disabled={!name.trim()} loading={busy}>
          {scene ? "Salvar" : "Criar cena"}
        </Button>
      </DialogActions>
    </form>
  );
}

export function SceneDialog({ open, ...props }: Props & { open: boolean }) {
  return (
    <Dialog open={open} onClose={props.onClose} fullWidth maxWidth="sm">
      <SceneForm {...props} />
    </Dialog>
  );
}
