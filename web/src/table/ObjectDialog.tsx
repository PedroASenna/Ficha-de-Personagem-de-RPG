import Button from "@mui/material/Button";
import Dialog from "@mui/material/Dialog";
import DialogActions from "@mui/material/DialogActions";
import DialogContent from "@mui/material/DialogContent";
import DialogTitle from "@mui/material/DialogTitle";
import FormControlLabel from "@mui/material/FormControlLabel";
import Stack from "@mui/material/Stack";
import Switch from "@mui/material/Switch";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import { type FormEvent, useState } from "react";

import type { Scene, SceneObject } from "../api/types";
import { addSceneObject, updateSceneObject } from "./actions";
import type { Point } from "./geometry";
import { ImagePicker } from "./ImagePicker";
import { useTable } from "./store";

interface Props {
  open: boolean;
  roomId: string;
  scene: Scene;
  obj: SceneObject | null; // null = novo
  at?: Point;
  onClose: () => void;
}

function cells(px: number, grid: number): number {
  return Math.max(0.5, Math.round((px / grid) * 2) / 2);
}

/** Carroça, barco, jaula…: bonecos soltos em cima entram e andam junto com ele. */
export function ObjectDialog({ open, roomId, scene, obj, at, onClose }: Props) {
  const grid = scene.grid_size;
  const [name, setName] = useState(obj?.name ?? "");
  const [image, setImage] = useState(obj?.image_key ? { key: obj.image_key, url: obj.url } : null);
  const [width, setWidth] = useState(obj ? cells(obj.width, grid) : 3);
  const [height, setHeight] = useState(obj ? cells(obj.height, grid) : 2);
  const [hideOccupants, setHideOccupants] = useState(obj?.hide_occupants ?? false);
  const [busy, setBusy] = useState(false);
  const selectObject = useTable((s) => s.selectObject);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    const body = {
      name: name.trim(),
      image_key: image?.key ?? null,
      width: width * grid,
      height: height * grid,
      hide_occupants: hideOccupants,
    };
    const saved = obj
      ? await updateSceneObject(obj.id, body)
      : await addSceneObject(scene.id, { ...body, x: at?.x ?? scene.map_width / 2, y: at?.y ?? scene.map_height / 2 });
    setBusy(false);
    if (saved) {
      if (!obj) selectObject(saved.id);
      onClose();
    }
  };

  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="xs">
      <form onSubmit={(e) => void submit(e)}>
        <DialogTitle>{obj ? `Editar ${obj.name}` : "Novo objeto"}</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ pt: 1 }}>
            <Typography variant="body2" color="text.secondary">
              Solte bonecos em cima do objeto para colocá-los dentro: quando você arrasta ou gira o objeto, eles vão
              junto.
            </Typography>
            <TextField
              label="Nome"
              placeholder="Carroça, Barco, Jaula…"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              autoFocus
              slotProps={{ htmlInput: { maxLength: 60 } }}
            />
            <ImagePicker
              roomId={roomId}
              kind="piece"
              label="Imagem do objeto (opcional; PNG com fundo transparente fica melhor)"
              previewUrl={image?.url ?? null}
              onUploaded={(uploaded) => {
                setImage({ key: uploaded.key, url: uploaded.url });
                // Mantém a proporção da imagem, com a largura escolhida.
                setHeight(Math.max(0.5, Math.round(((width * uploaded.height) / uploaded.width) * 2) / 2));
              }}
            />
            <Stack direction="row" spacing={2}>
              <TextField
                type="number"
                label="Largura (casas)"
                value={width}
                onChange={(e) => setWidth(Math.max(0.5, Number(e.target.value)))}
                slotProps={{ htmlInput: { min: 0.5, step: 0.5 } }}
                fullWidth
              />
              <TextField
                type="number"
                label="Altura (casas)"
                value={height}
                onChange={(e) => setHeight(Math.max(0.5, Number(e.target.value)))}
                slotProps={{ htmlInput: { min: 0.5, step: 0.5 } }}
                fullWidth
              />
            </Stack>
            <FormControlLabel
              control={<Switch checked={hideOccupants} onChange={(e) => setHideOccupants(e.target.checked)} />}
              label="Esconder dos jogadores quem está dentro"
            />
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={onClose}>Cancelar</Button>
          <Button type="submit" variant="contained" disabled={!name.trim()} loading={busy}>
            {obj ? "Salvar" : "Criar objeto"}
          </Button>
        </DialogActions>
      </form>
    </Dialog>
  );
}
