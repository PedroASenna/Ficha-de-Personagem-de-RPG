import AddIcon from "@mui/icons-material/Add";
import GroupsIcon from "@mui/icons-material/Groups";
import PlaceIcon from "@mui/icons-material/AddLocationAltOutlined";
import Avatar from "@mui/material/Avatar";
import Badge from "@mui/material/Badge";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Chip from "@mui/material/Chip";
import IconButton from "@mui/material/IconButton";
import LinearProgress from "@mui/material/LinearProgress";
import List from "@mui/material/List";
import ListItem from "@mui/material/ListItem";
import ListItemAvatar from "@mui/material/ListItemAvatar";
import ListItemButton from "@mui/material/ListItemButton";
import ListItemText from "@mui/material/ListItemText";
import Tab from "@mui/material/Tab";
import Tabs from "@mui/material/Tabs";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";
import { type DragEvent, useState } from "react";
import { useShallow } from "zustand/react/shallow";

import type { Npc, PartyMember, Scene } from "../api/types";
import { placeToken, updateToken } from "./actions";
import { snapPoint } from "./geometry";
import { NpcDialog } from "./NpcDialog";
import { characterScenes, npcTokenCount } from "./reducer";
import { CONDITION_COLOR, hpColor, hpRatio } from "./rules";
import { useTable } from "./store";
import { DRAG_MIME, type DragPayload } from "./tokens";

function startDrag(event: DragEvent, payload: DragPayload) {
  event.dataTransfer.setData(DRAG_MIME, JSON.stringify(payload));
  event.dataTransfer.effectAllowed = "copyMove";
}

/** Ponto livre perto do centro da cena (um ao lado do outro quando vários entram juntos). */
function centerSpot(scene: Scene, index = 0) {
  const g = scene.grid_size;
  return snapPoint(
    { x: scene.map_width / 2 + (index % 4) * g, y: scene.map_height / 2 + Math.floor(index / 4) * g },
    g,
  );
}

function HpLine({ current, max }: { current: number; max: number }) {
  const ratio = hpRatio(current, max);
  return (
    <LinearProgress
      variant="determinate"
      value={ratio * 100}
      sx={{
        height: 6,
        borderRadius: 3,
        mt: 0.5,
        bgcolor: "rgba(255,255,255,0.08)",
        "& .MuiLinearProgress-bar": { bgcolor: hpColor(ratio) },
      }}
    />
  );
}

function PartyRow({
  member,
  scene,
  sceneName,
}: {
  member: PartyMember;
  scene: Scene | null;
  sceneName: string | null;
}) {
  const online = useTable((s) => s.online[member.owner_id] ?? false);
  const tokenHere = useTable(
    (s) => Object.values(s.tokens).find((t) => t.character_id === member.id && t.scene_id === scene?.id)?.id ?? null,
  );
  const selected = useTable((s) => s.selection?.kind === "character" && s.selection.id === member.id);
  const select = useTable((s) => s.select);
  const roomId = useTable((s) => s.room?.id as string);

  return (
    <ListItem
      disablePadding
      secondaryAction={
        scene &&
        !tokenHere && (
          <Tooltip title={`Colocar em "${scene.name}"`}>
            <IconButton
              edge="end"
              aria-label={`Colocar ${member.name} na cena`}
              onClick={() =>
                void placeToken(roomId, { scene_id: scene.id, character_id: member.id, ...centerSpot(scene) })
              }
            >
              <PlaceIcon />
            </IconButton>
          </Tooltip>
        )
      }
    >
      <ListItemButton
        selected={selected}
        draggable
        onDragStart={(e) => startDrag(e, { kind: "character", id: member.id })}
        onClick={() => select({ kind: "character", id: member.id, tokenId: tokenHere })}
      >
        <ListItemAvatar>
          <Badge
            overlap="circular"
            variant="dot"
            color={online ? "success" : "default"}
            anchorOrigin={{ vertical: "bottom", horizontal: "right" }}
            title={online ? "Conectado" : "Fora da mesa"}
          >
            <Avatar src={member.portrait_url ?? undefined} sx={{ border: 2, borderColor: "secondary.main" }}>
              {member.name[0]}
            </Avatar>
          </Badge>
        </ListItemAvatar>
        <ListItemText
          primary={member.name}
          secondary={
            <>
              <Typography component="span" variant="caption" color="text.secondary">
                {[member.class_name, member.level_label ?? `Nv ${member.level}`].filter(Boolean).join(" · ")} ·{" "}
                {member.hp_current}/{member.hp_max} PV{member.hp_temp ? ` +${member.hp_temp}` : ""}
                {sceneName ? ` · ${sceneName}` : " · fora do mapa"}
              </Typography>
              <HpLine current={member.hp_current} max={member.hp_max} />
            </>
          }
          slotProps={{ secondary: { component: "div" } }}
        />
      </ListItemButton>
    </ListItem>
  );
}

function NpcRow({ npc, scene, onPlaced }: { npc: Npc; scene: Scene | null; onPlaced: number }) {
  const selected = useTable((s) => s.selection?.kind === "npc" && s.selection.id === npc.id);
  const tokenHere = useTable(
    (s) => Object.values(s.tokens).find((t) => t.npc_id === npc.id && t.scene_id === scene?.id)?.id ?? null,
  );
  const select = useTable((s) => s.select);
  const roomId = useTable((s) => s.room?.id as string);

  return (
    <ListItem
      disablePadding
      secondaryAction={
        scene &&
        !tokenHere && (
          <Tooltip title={`Colocar em "${scene.name}"`}>
            <IconButton
              edge="end"
              aria-label={`Colocar ${npc.name} na cena`}
              onClick={() => void placeToken(roomId, { scene_id: scene.id, npc_id: npc.id, ...centerSpot(scene, 1) })}
            >
              <PlaceIcon />
            </IconButton>
          </Tooltip>
        )
      }
    >
      <ListItemButton
        selected={selected}
        draggable
        onDragStart={(e) => startDrag(e, { kind: "npc", id: npc.id })}
        onClick={() => select({ kind: "npc", id: npc.id, tokenId: tokenHere })}
      >
        <ListItemAvatar>
          <Avatar
            src={npc.portrait_url ?? undefined}
            sx={{ border: 2, borderColor: "error.main", opacity: npc.condition === "caido" ? 0.5 : 1 }}
          >
            {npc.name[0]}
          </Avatar>
        </ListItemAvatar>
        <ListItemText
          primary={
            <Box component="span" sx={{ display: "flex", alignItems: "center", gap: 1 }}>
              <span>{npc.name}</span>
              <Chip
                size="small"
                label={npc.condition_label}
                sx={{ height: 18, fontSize: 11, bgcolor: CONDITION_COLOR[npc.condition], color: "#14100d" }}
              />
            </Box>
          }
          secondary={
            <>
              <Typography component="span" variant="caption" color="text.secondary">
                {npc.hp_current}/{npc.hp_max} PV{npc.armor_class !== null ? ` · CA ${npc.armor_class}` : ""}
                {onPlaced === 0 ? " · fora do mapa" : ""}
              </Typography>
              <HpLine current={npc.hp_current} max={npc.hp_max} />
            </>
          }
          slotProps={{ secondary: { component: "div" } }}
        />
      </ListItemButton>
    </ListItem>
  );
}

export function Roster({ roomId }: { roomId: string }) {
  const [tab, setTab] = useState<"party" | "enemies">("party");
  const [creating, setCreating] = useState(false);
  const party = useTable((s) => s.party);
  const npcs = useTable(useShallow((s) => Object.values(s.npcs)));
  const scenes = useTable((s) => s.scenes);
  const activeScene = useTable((s) => s.scenes.find((sc) => sc.id === s.activeSceneId) ?? null);
  const whereIs = useTable(useShallow(characterScenes));
  const placed = useTable(useShallow(npcTokenCount));

  const bringEveryone = async () => {
    if (!activeScene) return;
    const tokens = useTable.getState().tokens;
    let index = 0;
    for (const member of party) {
      const token = Object.values(tokens).find((t) => t.character_id === member.id);
      if (token?.scene_id === activeScene.id) continue;
      if (token) await updateToken(token.id, { scene_id: activeScene.id, ...centerSpot(activeScene, index) });
      else
        await placeToken(roomId, {
          scene_id: activeScene.id,
          character_id: member.id,
          ...centerSpot(activeScene, index),
        });
      index += 1;
    }
  };

  const sceneName = (id: string | undefined) => scenes.find((s) => s.id === id)?.name ?? null;

  return (
    <Box sx={{ display: "flex", flexDirection: "column", height: "100%", minHeight: 0 }}>
      <Tabs value={tab} onChange={(_, v: "party" | "enemies") => setTab(v)} variant="fullWidth">
        <Tab value="party" label={`Grupo (${party.length})`} />
        <Tab value="enemies" label={`Inimigos (${npcs.length})`} />
      </Tabs>
      <Box sx={{ flex: 1, overflowY: "auto" }}>
        {tab === "party" ? (
          <>
            {party.length === 0 ? (
              <Typography color="text.secondary" sx={{ p: 2 }}>
                Ninguém entrou ainda. Clique em “Conectar celulares” lá em cima e mostre o QR code para o grupo.
              </Typography>
            ) : (
              <List dense>
                {party.map((member) => (
                  <PartyRow
                    key={member.id}
                    member={member}
                    scene={activeScene}
                    sceneName={sceneName(whereIs[member.id])}
                  />
                ))}
              </List>
            )}
          </>
        ) : (
          <List dense>
            {npcs.length === 0 && (
              <Typography color="text.secondary" sx={{ p: 2 }}>
                Crie inimigos na hora, com imagem, PV, CA e atributos. Os jogadores só veem o nome, a imagem e se estão
                feridos.
              </Typography>
            )}
            {npcs.map((npc) => (
              <NpcRow key={npc.id} npc={npc} scene={activeScene} onPlaced={placed[npc.id] ?? 0} />
            ))}
          </List>
        )}
      </Box>
      <Box sx={{ p: 1.5, borderTop: 1, borderColor: "divider" }}>
        {tab === "party" ? (
          <Button
            fullWidth
            startIcon={<GroupsIcon />}
            disabled={!activeScene || party.length === 0}
            onClick={() => void bringEveryone()}
          >
            Trazer o grupo todo para esta cena
          </Button>
        ) : (
          <Button fullWidth variant="contained" startIcon={<AddIcon />} onClick={() => setCreating(true)}>
            Novo inimigo
          </Button>
        )}
        <Typography variant="caption" color="text.disabled" sx={{ display: "block", mt: 1, textAlign: "center" }}>
          Arraste da lista para o mapa para posicionar
        </Typography>
      </Box>
      <NpcDialog open={creating} roomId={roomId} npc={null} onClose={() => setCreating(false)} />
    </Box>
  );
}
