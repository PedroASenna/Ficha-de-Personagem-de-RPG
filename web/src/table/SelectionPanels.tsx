// Painel lateral quando há peças de cenário ou um objeto selecionado no mapa.

import CopyIcon from "@mui/icons-material/ContentCopyOutlined";
import DeleteIcon from "@mui/icons-material/DeleteOutlined";
import EditIcon from "@mui/icons-material/EditOutlined";
import FlipToBackIcon from "@mui/icons-material/FlipToBack";
import FlipToFrontIcon from "@mui/icons-material/FlipToFront";
import LockIcon from "@mui/icons-material/LockOutlined";
import LockOpenIcon from "@mui/icons-material/LockOpenOutlined";
import SelectAllIcon from "@mui/icons-material/SelectAll";
import Avatar from "@mui/material/Avatar";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import FormControlLabel from "@mui/material/FormControlLabel";
import List from "@mui/material/List";
import ListItem from "@mui/material/ListItem";
import ListItemAvatar from "@mui/material/ListItemAvatar";
import ListItemText from "@mui/material/ListItemText";
import Stack from "@mui/material/Stack";
import Switch from "@mui/material/Switch";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import { useState } from "react";
import { useShallow } from "zustand/react/shallow";

import type { SceneImage, SceneObject } from "../api/types";
import {
  addSceneImage,
  deleteSceneImages,
  deleteSceneObject,
  updateSceneImages,
  updateSceneObject,
  updateToken,
} from "./actions";
import { ObjectDialog } from "./ObjectDialog";
import { sceneImages } from "./reducer";
import { RotationControl } from "./RotationControl";
import { useTable } from "./store";

function Title({ children }: { children: string }) {
  return (
    <Typography variant="overline" color="text.secondary" sx={{ display: "block", mt: 2, lineHeight: 2 }}>
      {children}
    </Typography>
  );
}

/** Uma ou várias peças: ângulo (todas juntas), ordem, trava, duplicar e apagar. */
export function PiecesPanel({ pieces }: { pieces: SceneImage[] }) {
  const dispatch = useTable((s) => s.dispatch);
  const selectImages = useTable((s) => s.selectImages);
  const scenePieces = useTable(useShallow((s) => sceneImages(s, pieces[0]?.scene_id ?? null)));
  const first = pieces[0];
  if (!first) return null;
  const many = pieces.length > 1;
  const allLocked = pieces.every((p) => p.locked);
  const zs = scenePieces.map((p) => p.z);

  // Pré-visualização local enquanto arrasta o controle; salva ao soltar.
  const preview = (rotation: number) => {
    for (const piece of pieces) dispatch({ type: "image.upserted", image: { ...piece, rotation } });
  };
  const save = (patch: (piece: SceneImage, index: number) => Partial<SceneImage>) =>
    void updateSceneImages(pieces.map((piece, index) => ({ id: piece.id, ...patch(piece, index) })));

  const duplicate = async () => {
    const ids: string[] = [];
    for (const piece of pieces) {
      const copy = await addSceneImage(piece.scene_id, {
        image_key: piece.image_key,
        x: piece.x + 40,
        y: piece.y + 40,
        width: piece.width,
        height: piece.height,
        rotation: piece.rotation,
      });
      if (copy) ids.push(copy.id);
    }
    if (ids.length) selectImages(ids);
  };

  return (
    <Box sx={{ p: 2 }} data-testid="pieces-panel">
      <Stack direction="row" spacing={2} sx={{ alignItems: "center" }}>
        <Avatar variant="rounded" src={first.url} sx={{ width: 56, height: 56, bgcolor: "rgba(0,0,0,0.3)" }} />
        <Box>
          <Typography variant="h6">{many ? `${pieces.length} peças de cenário` : "Peça de cenário"}</Typography>
          <Typography variant="caption" color="text.secondary">
            {many
              ? "Arraste qualquer uma para mover todas; use as alças para girar ou redimensionar juntas."
              : `${Math.round(first.width)} × ${Math.round(first.height)} px · Shift+clique para selecionar mais`}
          </Typography>
        </Box>
      </Stack>

      <Title>Ângulo</Title>
      <RotationControl value={first.rotation} onChange={preview} onCommit={(rotation) => save(() => ({ rotation }))} />

      <Title>Organizar</Title>
      <Stack direction="row" spacing={1} useFlexGap sx={{ flexWrap: "wrap" }}>
        <Button
          size="small"
          startIcon={<FlipToFrontIcon />}
          onClick={() => save((_, i) => ({ z: Math.min(1000, Math.max(...zs) + 1 + i) }))}
        >
          Para a frente
        </Button>
        <Button
          size="small"
          startIcon={<FlipToBackIcon />}
          onClick={() => save((_, i) => ({ z: Math.max(-1000, Math.min(...zs) - pieces.length + i) }))}
        >
          Para trás
        </Button>
        <Button
          size="small"
          startIcon={allLocked ? <LockOpenIcon /> : <LockIcon />}
          onClick={() => save(() => ({ locked: !allLocked }))}
        >
          {allLocked ? "Destravar" : "Travar no lugar"}
        </Button>
        <Button size="small" startIcon={<CopyIcon />} onClick={() => void duplicate()}>
          Duplicar
        </Button>
        <Button size="small" startIcon={<SelectAllIcon />} onClick={() => selectImages(scenePieces.map((p) => p.id))}>
          Selecionar todas
        </Button>
      </Stack>
      {allLocked && (
        <Typography variant="caption" color="text.secondary">
          Peças travadas não saem do lugar: arrastar em cima delas move o mapa.
        </Typography>
      )}

      <Button
        color="error"
        startIcon={<DeleteIcon />}
        sx={{ mt: 2 }}
        onClick={() =>
          window.confirm(many ? `Apagar ${pieces.length} peças?` : "Apagar esta peça?") &&
          void deleteSceneImages(pieces.map((p) => p.id))
        }
      >
        {many ? `Apagar ${pieces.length} peças` : "Apagar peça"}
      </Button>
    </Box>
  );
}

/** Objeto: nome, ângulo, esconder ocupantes e quem está dentro. */
export function ObjectPanel({ obj }: { obj: SceneObject }) {
  const room = useTable((s) => s.room);
  const scene = useTable((s) => s.scenes.find((sc) => sc.id === obj.scene_id));
  const dispatch = useTable((s) => s.dispatch);
  const select = useTable((s) => s.select);
  const inside = useTable(useShallow((s) => Object.values(s.tokens).filter((t) => t.container_id === obj.id)));
  const npcs = useTable((s) => s.npcs);
  const party = useTable((s) => s.party);
  const topZ = useTable((s) => Math.max(0, ...Object.values(s.objects).map((o) => o.z)));
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(obj.name);

  const who = (tokenId: string) => {
    const token = inside.find((t) => t.id === tokenId);
    const npc = token?.npc_id ? npcs[token.npc_id] : undefined;
    const member = token?.character_id ? party.find((p) => p.id === token.character_id) : undefined;
    return { name: npc?.name ?? member?.name ?? "?", image: npc?.portrait_url ?? member?.portrait_url ?? undefined };
  };

  return (
    <Box sx={{ p: 2 }} data-testid="object-panel">
      <Stack direction="row" spacing={2} sx={{ alignItems: "center" }}>
        <Avatar variant="rounded" src={obj.url ?? undefined} sx={{ width: 56, height: 56, bgcolor: "#7a5630" }}>
          {obj.name[0]}
        </Avatar>
        <TextField
          size="small"
          label="Nome do objeto"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onBlur={() => name.trim() && name !== obj.name && void updateSceneObject(obj.id, { name: name.trim() })}
          slotProps={{ htmlInput: { maxLength: 60 } }}
          sx={{ flex: 1 }}
        />
      </Stack>
      <FormControlLabel
        sx={{ mt: 1 }}
        control={
          <Switch
            checked={obj.hide_occupants}
            onChange={(e) => void updateSceneObject(obj.id, { hide_occupants: e.target.checked })}
          />
        }
        label="Esconder dos jogadores quem está dentro"
      />

      <Title>Ângulo (quem está dentro gira junto)</Title>
      <RotationControl
        value={obj.rotation}
        onChange={(rotation) => dispatch({ type: "object.upserted", object: { ...obj, rotation }, tokens: [] })}
        onCommit={(rotation) => void updateSceneObject(obj.id, { rotation })}
      />

      <Title>{inside.length ? `Dentro (${inside.length})` : "Ninguém dentro"}</Title>
      {inside.length === 0 && (
        <Typography variant="body2" color="text.secondary">
          Arraste bonecos e solte em cima do objeto para colocá-los dentro.
        </Typography>
      )}
      <List dense disablePadding>
        {inside.map((token) => {
          const info = who(token.id);
          return (
            <ListItem
              key={token.id}
              disableGutters
              secondaryAction={
                <Button size="small" onClick={() => void updateToken(token.id, { container_id: null })}>
                  Tirar
                </Button>
              }
            >
              <ListItemAvatar sx={{ minWidth: 40 }}>
                <Avatar src={info.image} sx={{ width: 28, height: 28 }}>
                  {info.name[0]}
                </Avatar>
              </ListItemAvatar>
              <ListItemText
                primary={info.name}
                onClick={() =>
                  select(
                    token.npc_id
                      ? { kind: "npc", id: token.npc_id, tokenId: token.id }
                      : { kind: "character", id: token.character_id as string, tokenId: token.id },
                  )
                }
                sx={{ cursor: "pointer" }}
              />
            </ListItem>
          );
        })}
      </List>

      <Stack direction="row" spacing={1} useFlexGap sx={{ mt: 2, flexWrap: "wrap" }}>
        <Button size="small" startIcon={<EditIcon />} onClick={() => setEditing(true)}>
          Imagem e tamanho
        </Button>
        <Button
          size="small"
          startIcon={<FlipToFrontIcon />}
          onClick={() => void updateSceneObject(obj.id, { z: Math.min(1000, topZ + 1) })}
        >
          Para a frente
        </Button>
        <Button
          size="small"
          color="error"
          startIcon={<DeleteIcon />}
          onClick={() =>
            window.confirm(`Apagar ${obj.name}? Quem está dentro fica no lugar.`) && void deleteSceneObject(obj.id)
          }
        >
          Apagar
        </Button>
      </Stack>
      {editing && room && scene && (
        <ObjectDialog open roomId={room.id} scene={scene} obj={obj} onClose={() => setEditing(false)} />
      )}
    </Box>
  );
}
