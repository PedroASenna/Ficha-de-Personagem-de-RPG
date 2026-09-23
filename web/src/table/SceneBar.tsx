import AddIcon from "@mui/icons-material/Add";
import EditIcon from "@mui/icons-material/EditOutlined";
import Badge from "@mui/material/Badge";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import IconButton from "@mui/material/IconButton";
import Tab from "@mui/material/Tab";
import Tabs from "@mui/material/Tabs";
import Tooltip from "@mui/material/Tooltip";
import { useState } from "react";
import { useShallow } from "zustand/react/shallow";

import { characterScenes } from "./reducer";
import { SceneDialog } from "./SceneDialog";
import { useTable } from "./store";

/** Abas das cenas: o grupo pode estar espalhado; o número mostra quantos personagens estão em cada uma. */
export function SceneBar({ roomId }: { roomId: string }) {
  const scenes = useTable((s) => s.scenes);
  const activeSceneId = useTable((s) => s.activeSceneId);
  const setActiveScene = useTable((s) => s.setActiveScene);
  const whereIs = useTable(useShallow(characterScenes));
  const [dialog, setDialog] = useState<"new" | "edit" | null>(null);
  const active = scenes.find((s) => s.id === activeSceneId) ?? null;

  const playersIn = (sceneId: string) => Object.values(whereIs).filter((id) => id === sceneId).length;

  return (
    <Box sx={{ display: "flex", alignItems: "center", borderBottom: 1, borderColor: "divider", px: 1, minHeight: 48 }}>
      {scenes.length > 0 ? (
        <Tabs
          value={active?.id ?? false}
          onChange={(_, value: string) => setActiveScene(value)}
          variant="scrollable"
          scrollButtons="auto"
          sx={{ flex: 1, minWidth: 0 }}
        >
          {scenes.map((scene) => (
            <Tab
              key={scene.id}
              value={scene.id}
              label={
                <Badge badgeContent={playersIn(scene.id)} color="secondary" sx={{ pr: playersIn(scene.id) ? 1.5 : 0 }}>
                  {scene.name}
                </Badge>
              }
            />
          ))}
        </Tabs>
      ) : (
        <Box sx={{ flex: 1, color: "text.secondary", px: 1 }}>Nenhuma cena ainda. Crie a primeira com o mapa.</Box>
      )}
      {active && (
        <Tooltip title="Editar cena (nome, mapa, grade)">
          <IconButton aria-label="Editar cena" onClick={() => setDialog("edit")}>
            <EditIcon />
          </IconButton>
        </Tooltip>
      )}
      <Button startIcon={<AddIcon />} onClick={() => setDialog("new")} sx={{ ml: 1, flexShrink: 0 }}>
        Nova cena
      </Button>
      <SceneDialog
        key={dialog === "edit" ? active?.id : "new"}
        open={dialog !== null}
        roomId={roomId}
        scene={dialog === "edit" ? active : null}
        onClose={() => setDialog(null)}
      />
    </Box>
  );
}
