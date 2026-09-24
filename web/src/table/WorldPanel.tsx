// Mapa-múndi da campanha: a imagem do mundo e as fichas de nações e facções com as relações entre elas.
// Só fichas: nada é desenhado no mapa. O Mestre decide o que os jogadores já descobriram.

import AddIcon from "@mui/icons-material/Add";
import CenterFocusIcon from "@mui/icons-material/CenterFocusStrong";
import DeleteIcon from "@mui/icons-material/DeleteOutlined";
import EditIcon from "@mui/icons-material/EditOutlined";
import MapIcon from "@mui/icons-material/MapOutlined";
import VisibilityIcon from "@mui/icons-material/Visibility";
import VisibilityOffIcon from "@mui/icons-material/VisibilityOffOutlined";
import Avatar from "@mui/material/Avatar";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Card from "@mui/material/Card";
import CardActionArea from "@mui/material/CardActionArea";
import Chip from "@mui/material/Chip";
import Dialog from "@mui/material/Dialog";
import DialogActions from "@mui/material/DialogActions";
import DialogContent from "@mui/material/DialogContent";
import DialogTitle from "@mui/material/DialogTitle";
import FormControlLabel from "@mui/material/FormControlLabel";
import IconButton from "@mui/material/IconButton";
import MenuItem from "@mui/material/MenuItem";
import Paper from "@mui/material/Paper";
import Stack from "@mui/material/Stack";
import Switch from "@mui/material/Switch";
import Tab from "@mui/material/Tab";
import Tabs from "@mui/material/Tabs";
import TextField from "@mui/material/TextField";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";
import type { KonvaEventObject } from "konva/lib/Node";
import { type FormEvent, useLayoutEffect, useRef, useState } from "react";
import { Image as KonvaImage, Layer, Stage } from "react-konva";
import useImage from "use-image";
import { useShallow } from "zustand/react/shallow";

import type { Faction, FactionKind, Relation, RelationKind } from "../api/types";
import {
  createFaction,
  deleteFaction,
  deleteRelation,
  type FactionForm,
  setRelation,
  updateFaction,
  updateWorld,
} from "./actions";
import { fitView, type View, zoomAt } from "./geometry";
import { ImagePicker } from "./ImagePicker";
import { useTable } from "./store";

const RELATION_LABEL: Record<RelationKind, string> = {
  alliance: "Aliança",
  friendly: "Amizade",
  neutral: "Neutra",
  tense: "Tensão",
  war: "Guerra",
};

const RELATION_COLOR: Record<RelationKind, string> = {
  alliance: "#62c370",
  friendly: "#4fb3a9",
  neutral: "#cfc6b8",
  tense: "#e3a13b",
  war: "#e0584a",
};

const KIND_LABEL: Record<FactionKind, string> = { nation: "Nação", faction: "Facção" };

// ---------- mapa ----------

function WorldMap({ url, width, height }: { url: string; width: number; height: number }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [userView, setUserView] = useState<View | null>(null);
  const [image] = useImage(url, "anonymous");

  useLayoutEffect(() => {
    const element = containerRef.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) =>
      setSize({ width: Math.floor(entry.contentRect.width), height: Math.floor(entry.contentRect.height) }),
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const view = userView ?? fitView(width, height, size.width || 1, size.height || 1);
  const onWheel = (event: KonvaEventObject<WheelEvent>) => {
    event.evt.preventDefault();
    const pointer = event.target.getStage()?.getPointerPosition();
    if (pointer) setUserView(zoomAt(view, pointer, event.evt.deltaY > 0 ? 1 / 1.12 : 1.12));
  };

  return (
    <Box
      ref={containerRef}
      data-testid="world-map"
      sx={{ position: "relative", flex: 1, minHeight: 0, bgcolor: "#0f0c0a" }}
    >
      {size.width > 0 && (
        <Stage
          width={size.width}
          height={size.height}
          x={view.x}
          y={view.y}
          scaleX={view.scale}
          scaleY={view.scale}
          draggable
          onWheel={onWheel}
          onDragEnd={(e) => {
            const stage = e.target.getStage();
            if (stage && e.target === stage) setUserView({ ...view, x: stage.x(), y: stage.y() });
          }}
        >
          <Layer>{image && <KonvaImage image={image} width={width} height={height} />}</Layer>
        </Stage>
      )}
      <Tooltip title="Enquadrar o mapa">
        <IconButton
          aria-label="Enquadrar o mapa-múndi"
          onClick={() => setUserView(null)}
          sx={{ position: "absolute", right: 12, bottom: 12, bgcolor: "background.paper" }}
        >
          <CenterFocusIcon />
        </IconButton>
      </Tooltip>
    </Box>
  );
}

function MapDialog({ roomId, onClose }: { roomId: string; onClose: () => void }) {
  const world = useTable((s) => s.world);
  return (
    <Dialog open onClose={onClose} fullWidth maxWidth="sm">
      <DialogTitle>Imagem do mapa-múndi</DialogTitle>
      <DialogContent>
        <ImagePicker
          roomId={roomId}
          kind="map"
          label="Solte o mapa do mundo aqui ou clique para escolher (até 20 MB)"
          previewUrl={world?.map_url ?? null}
          onUploaded={(image) => {
            void updateWorld(roomId, { map_key: image.key, map_width: image.width, map_height: image.height });
            onClose();
          }}
        />
      </DialogContent>
      <DialogActions>
        {world?.map_key && (
          <Button
            color="error"
            sx={{ mr: "auto" }}
            onClick={() => {
              void updateWorld(roomId, { map_key: null });
              onClose();
            }}
          >
            Remover mapa
          </Button>
        )}
        <Button onClick={onClose}>Fechar</Button>
      </DialogActions>
    </Dialog>
  );
}

// ---------- fichas ----------

const EMPTY_FORM: FactionForm = {
  kind: "nation",
  name: "",
  emblem_key: null,
  color: "#8a6d3b",
  leader: "",
  seat: "",
  description: "",
  secret_notes: "",
  parent_id: null,
  revealed: false,
};

function FactionDialog({
  roomId,
  faction,
  kind,
  onClose,
}: {
  roomId: string;
  faction: Faction | null;
  kind: FactionKind;
  onClose: () => void;
}) {
  const nations = useTable(
    useShallow((s) => (s.world?.factions ?? []).filter((f) => f.kind === "nation" && f.id !== faction?.id)),
  );
  const [form, setForm] = useState<FactionForm>(() => {
    if (!faction) return { ...EMPTY_FORM, kind };
    const { kind: k, name, emblem_key, color, leader, seat, description, secret_notes, parent_id, revealed } = faction;
    return { kind: k, name, emblem_key, color, leader, seat, description, secret_notes, parent_id, revealed };
  });
  const [emblemUrl, setEmblemUrl] = useState(faction?.emblem_url ?? null);
  const [busy, setBusy] = useState(false);
  const set = <K extends keyof FactionForm>(key: K, value: FactionForm[K]) => setForm((f) => ({ ...f, [key]: value }));

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    const body = { ...form, name: form.name.trim(), parent_id: form.kind === "faction" ? form.parent_id : null };
    const saved = faction ? await updateFaction(faction.id, body) : await createFaction(roomId, body);
    setBusy(false);
    if (saved) onClose();
  };

  const remove = async () => {
    if (!faction || !window.confirm(`Apagar ${faction.name}? As relações dela também somem.`)) return;
    await deleteFaction(faction.id);
    onClose();
  };

  const isNation = form.kind === "nation";
  return (
    <Dialog open onClose={onClose} fullWidth maxWidth="sm">
      <form onSubmit={(e) => void submit(e)}>
        <DialogTitle>{faction ? `Ficha: ${faction.name}` : isNation ? "Nova nação" : "Nova facção"}</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ pt: 1 }}>
            <Stack direction="row" spacing={2} sx={{ alignItems: "flex-start" }}>
              <ImagePicker
                roomId={roomId}
                kind="emblem"
                label="Brasão ou bandeira"
                previewUrl={emblemUrl}
                onUploaded={(image) => {
                  set("emblem_key", image.key);
                  setEmblemUrl(image.url);
                }}
              />
              <Stack spacing={2} sx={{ flex: 1 }}>
                <Stack direction="row" spacing={1}>
                  <TextField
                    select
                    label="Tipo"
                    value={form.kind}
                    onChange={(e) => set("kind", e.target.value as FactionKind)}
                    sx={{ width: 130 }}
                  >
                    <MenuItem value="nation">Nação</MenuItem>
                    <MenuItem value="faction">Facção</MenuItem>
                  </TextField>
                  <TextField
                    label="Nome"
                    value={form.name}
                    onChange={(e) => set("name", e.target.value)}
                    required
                    autoFocus
                    slotProps={{ htmlInput: { maxLength: 60 } }}
                    sx={{ flex: 1 }}
                  />
                </Stack>
                <Stack direction="row" spacing={1} sx={{ alignItems: "center" }}>
                  <TextField
                    label="Cor"
                    type="color"
                    value={form.color}
                    onChange={(e) => set("color", e.target.value)}
                    sx={{ width: 90 }}
                  />
                  {!isNation && (
                    <TextField
                      select
                      label="Atua dentro da nação"
                      value={form.parent_id ?? ""}
                      onChange={(e) => set("parent_id", e.target.value || null)}
                      sx={{ flex: 1 }}
                    >
                      <MenuItem value="">Nenhuma (independente)</MenuItem>
                      {nations.map((n) => (
                        <MenuItem key={n.id} value={n.id}>
                          {n.name}
                        </MenuItem>
                      ))}
                    </TextField>
                  )}
                </Stack>
              </Stack>
            </Stack>
            <Stack direction="row" spacing={2}>
              <TextField
                label={isNation ? "Governante" : "Líder"}
                value={form.leader}
                onChange={(e) => set("leader", e.target.value)}
                slotProps={{ htmlInput: { maxLength: 80 } }}
                fullWidth
              />
              <TextField
                label={isNation ? "Capital" : "Sede"}
                value={form.seat}
                onChange={(e) => set("seat", e.target.value)}
                slotProps={{ htmlInput: { maxLength: 80 } }}
                fullWidth
              />
            </Stack>
            <TextField
              label="Descrição (os jogadores veem quando revelada)"
              value={form.description}
              onChange={(e) => set("description", e.target.value)}
              multiline
              minRows={3}
              slotProps={{ htmlInput: { maxLength: 5000 } }}
            />
            <TextField
              label="Notas secretas (só você)"
              value={form.secret_notes}
              onChange={(e) => set("secret_notes", e.target.value)}
              multiline
              minRows={2}
              slotProps={{ htmlInput: { maxLength: 5000 } }}
            />
            <FormControlLabel
              control={<Switch checked={form.revealed} onChange={(e) => set("revealed", e.target.checked)} />}
              label={form.revealed ? "Revelada aos jogadores" : "Secreta (os jogadores ainda não conhecem)"}
            />
          </Stack>
        </DialogContent>
        <DialogActions>
          {faction && (
            <Button color="error" onClick={() => void remove()} sx={{ mr: "auto" }}>
              Apagar
            </Button>
          )}
          <Button onClick={onClose}>Cancelar</Button>
          <Button type="submit" variant="contained" disabled={!form.name.trim()} loading={busy}>
            {faction ? "Salvar" : "Criar"}
          </Button>
        </DialogActions>
      </form>
    </Dialog>
  );
}

function RelationDialog({
  roomId,
  relation,
  onClose,
}: {
  roomId: string;
  relation: Relation | null;
  onClose: () => void;
}) {
  const factions = useTable(useShallow((s) => s.world?.factions ?? []));
  const [a, setA] = useState(relation?.a_id ?? "");
  const [b, setB] = useState(relation?.b_id ?? "");
  const [kind, setKind] = useState<RelationKind>(relation?.kind ?? "neutral");
  const [note, setNote] = useState(relation?.note ?? "");
  const [revealed, setRevealed] = useState(relation?.revealed ?? false);
  const [busy, setBusy] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    const saved = await setRelation(roomId, { a_id: a, b_id: b, kind, note: note.trim(), revealed });
    setBusy(false);
    if (saved) onClose();
  };

  const options = (exclude: string) =>
    factions
      .filter((f) => f.id !== exclude)
      .map((f) => (
        <MenuItem key={f.id} value={f.id}>
          {f.name} ({KIND_LABEL[f.kind]})
        </MenuItem>
      ));

  return (
    <Dialog open onClose={onClose} fullWidth maxWidth="xs">
      <form onSubmit={(e) => void submit(e)}>
        <DialogTitle>{relation ? "Editar relação" : "Nova relação"}</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ pt: 1 }}>
            <TextField select label="Entre" value={a} onChange={(e) => setA(e.target.value)} disabled={!!relation}>
              {options(b)}
            </TextField>
            <TextField select label="E" value={b} onChange={(e) => setB(e.target.value)} disabled={!!relation}>
              {options(a)}
            </TextField>
            <TextField select label="Relação" value={kind} onChange={(e) => setKind(e.target.value as RelationKind)}>
              {(Object.keys(RELATION_LABEL) as RelationKind[]).map((k) => (
                <MenuItem key={k} value={k}>
                  {RELATION_LABEL[k]}
                </MenuItem>
              ))}
            </TextField>
            <TextField
              label="Detalhe (opcional)"
              placeholder="Tratado de paz, disputa de fronteira…"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              slotProps={{ htmlInput: { maxLength: 200 } }}
            />
            <FormControlLabel
              control={<Switch checked={revealed} onChange={(e) => setRevealed(e.target.checked)} />}
              label="Os jogadores sabem (se conhecerem os dois lados)"
            />
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={onClose}>Cancelar</Button>
          <Button type="submit" variant="contained" disabled={!a || !b || a === b} loading={busy}>
            Salvar
          </Button>
        </DialogActions>
      </form>
    </Dialog>
  );
}

function FactionCard({ faction, parent, onOpen }: { faction: Faction; parent?: Faction; onOpen: () => void }) {
  const subtitle = [faction.leader, faction.seat, parent ? `em ${parent.name}` : null].filter(Boolean).join(" · ");
  return (
    <Card variant="outlined" sx={{ borderLeft: 6, borderLeftColor: faction.color }}>
      <Stack direction="row" sx={{ alignItems: "center" }}>
        <CardActionArea onClick={onOpen} sx={{ p: 1.5, flex: 1, minWidth: 0 }}>
          <Stack direction="row" spacing={1.5} sx={{ alignItems: "center" }}>
            <Avatar src={faction.emblem_url ?? undefined} variant="rounded" sx={{ bgcolor: faction.color }}>
              {faction.name[0]}
            </Avatar>
            <Box sx={{ minWidth: 0 }}>
              <Typography noWrap sx={{ fontWeight: 600 }}>
                {faction.name}
              </Typography>
              <Typography variant="caption" color="text.secondary" noWrap sx={{ display: "block" }}>
                {subtitle || KIND_LABEL[faction.kind]}
              </Typography>
            </Box>
          </Stack>
        </CardActionArea>
        <Tooltip title={faction.revealed ? "Revelada: clique para esconder" : "Secreta: clique para revelar"}>
          <IconButton
            aria-label={faction.revealed ? `Esconder ${faction.name}` : `Revelar ${faction.name}`}
            onClick={() => void updateFaction(faction.id, { revealed: !faction.revealed })}
            color={faction.revealed ? "primary" : "default"}
            sx={{ mx: 0.5 }}
          >
            {faction.revealed ? <VisibilityIcon /> : <VisibilityOffIcon />}
          </IconButton>
        </Tooltip>
      </Stack>
    </Card>
  );
}

export function WorldPanel({ roomId }: { roomId: string }) {
  const world = useTable((s) => s.world);
  const [tab, setTab] = useState<"nation" | "faction" | "relations">("nation");
  const [mapDialog, setMapDialog] = useState(false);
  const [editing, setEditing] = useState<{ faction: Faction | null; kind: FactionKind } | null>(null);
  const [relation, setRelationDialog] = useState<{ relation: Relation | null } | null>(null);
  const factions = world?.factions ?? [];
  const byId = Object.fromEntries(factions.map((f) => [f.id, f]));
  const listed = tab === "relations" ? [] : factions.filter((f) => f.kind === tab);

  return (
    <Box sx={{ flex: 1, minHeight: 0, display: "grid", gridTemplateColumns: "minmax(0, 1fr) 420px" }}>
      <Box sx={{ display: "flex", flexDirection: "column", minHeight: 0 }}>
        <Stack
          direction="row"
          spacing={1}
          sx={{ alignItems: "center", px: 1.5, minHeight: 48, borderBottom: 1, borderColor: "divider" }}
        >
          <Typography variant="subtitle1" sx={{ flex: 1 }}>
            Mapa-múndi
          </Typography>
          {world?.map_url && (
            <FormControlLabel
              control={
                <Switch
                  checked={world.visible}
                  onChange={(e) => void updateWorld(roomId, { visible: e.target.checked })}
                />
              }
              label={world.visible ? "Jogadores veem o mapa" : "Mapa escondido dos jogadores"}
            />
          )}
          <Button startIcon={<MapIcon />} onClick={() => setMapDialog(true)}>
            {world?.map_url ? "Trocar imagem" : "Enviar mapa"}
          </Button>
        </Stack>
        {world?.map_url && world.map_width && world.map_height ? (
          <WorldMap url={world.map_url} width={world.map_width} height={world.map_height} />
        ) : (
          <Box sx={{ flex: 1, display: "grid", placeItems: "center", p: 3, textAlign: "center" }}>
            <Stack spacing={2} sx={{ alignItems: "center", maxWidth: 420 }}>
              <Typography variant="h5">O mundo da campanha</Typography>
              <Typography color="text.secondary">
                Envie a imagem do mapa-múndi e cadastre as nações e facções ao lado. Os jogadores só veem o que você
                revelar.
              </Typography>
              <Button variant="contained" startIcon={<MapIcon />} onClick={() => setMapDialog(true)}>
                Enviar mapa-múndi
              </Button>
            </Stack>
          </Box>
        )}
      </Box>

      <Paper
        square
        elevation={0}
        sx={{ borderLeft: 1, borderColor: "divider", display: "flex", flexDirection: "column", minHeight: 0 }}
      >
        <Tabs value={tab} onChange={(_, v: typeof tab) => setTab(v)} variant="fullWidth">
          <Tab value="nation" label={`Nações (${factions.filter((f) => f.kind === "nation").length})`} />
          <Tab value="faction" label={`Facções (${factions.filter((f) => f.kind === "faction").length})`} />
          <Tab value="relations" label={`Relações (${world?.relations.length ?? 0})`} />
        </Tabs>
        <Box sx={{ flex: 1, overflowY: "auto", p: 1.5 }}>
          <Stack spacing={1}>
            {tab !== "relations" &&
              listed.map((faction) => (
                <FactionCard
                  key={faction.id}
                  faction={faction}
                  parent={faction.parent_id ? byId[faction.parent_id] : undefined}
                  onOpen={() => setEditing({ faction, kind: faction.kind })}
                />
              ))}
            {tab !== "relations" && listed.length === 0 && (
              <Typography color="text.secondary" sx={{ p: 2, textAlign: "center" }}>
                {tab === "nation"
                  ? "Nenhuma nação ainda: reinos, impérios, cidades-estado…"
                  : "Nenhuma facção ainda: guildas, ordens, cultos, rebeldes…"}
              </Typography>
            )}
            {tab === "relations" &&
              (world?.relations ?? []).map((r) => (
                <Card key={r.id} variant="outlined" sx={{ p: 1.5 }}>
                  <Stack direction="row" spacing={1} sx={{ alignItems: "center" }}>
                    <Box sx={{ flex: 1, minWidth: 0 }}>
                      <Typography noWrap>
                        {byId[r.a_id]?.name ?? "?"} ⟷ {byId[r.b_id]?.name ?? "?"}
                      </Typography>
                      {r.note && (
                        <Typography variant="caption" color="text.secondary">
                          {r.note}
                        </Typography>
                      )}
                    </Box>
                    <Chip
                      size="small"
                      label={RELATION_LABEL[r.kind]}
                      sx={{ bgcolor: RELATION_COLOR[r.kind], color: "#14100d", fontWeight: 600 }}
                    />
                    <Tooltip title={r.revealed ? "Os jogadores sabem" : "Secreta"}>
                      <IconButton
                        size="small"
                        aria-label={r.revealed ? "Esconder relação" : "Revelar relação"}
                        onClick={() =>
                          void setRelation(roomId, {
                            a_id: r.a_id,
                            b_id: r.b_id,
                            kind: r.kind,
                            note: r.note,
                            revealed: !r.revealed,
                          })
                        }
                        color={r.revealed ? "primary" : "default"}
                      >
                        {r.revealed ? <VisibilityIcon fontSize="small" /> : <VisibilityOffIcon fontSize="small" />}
                      </IconButton>
                    </Tooltip>
                    <IconButton
                      size="small"
                      aria-label="Editar relação"
                      onClick={() => setRelationDialog({ relation: r })}
                    >
                      <EditIcon fontSize="small" />
                    </IconButton>
                    <IconButton
                      size="small"
                      aria-label="Apagar relação"
                      onClick={() => window.confirm("Apagar esta relação?") && void deleteRelation(r.id)}
                    >
                      <DeleteIcon fontSize="small" />
                    </IconButton>
                  </Stack>
                </Card>
              ))}
            {tab === "relations" && (world?.relations.length ?? 0) === 0 && (
              <Typography color="text.secondary" sx={{ p: 2, textAlign: "center" }}>
                Alianças, rivalidades e guerras entre nações e facções aparecem aqui.
              </Typography>
            )}
          </Stack>
        </Box>
        <Box sx={{ p: 1.5, borderTop: 1, borderColor: "divider" }}>
          {tab === "relations" ? (
            <Button
              fullWidth
              variant="contained"
              startIcon={<AddIcon />}
              disabled={factions.length < 2}
              onClick={() => setRelationDialog({ relation: null })}
            >
              Nova relação
            </Button>
          ) : (
            <Button
              fullWidth
              variant="contained"
              startIcon={<AddIcon />}
              onClick={() => setEditing({ faction: null, kind: tab })}
            >
              {tab === "nation" ? "Nova nação" : "Nova facção"}
            </Button>
          )}
        </Box>
      </Paper>

      {mapDialog && <MapDialog roomId={roomId} onClose={() => setMapDialog(false)} />}
      {editing && (
        <FactionDialog
          key={editing.faction?.id ?? "new"}
          roomId={roomId}
          faction={editing.faction}
          kind={editing.kind}
          onClose={() => setEditing(null)}
        />
      )}
      {relation && (
        <RelationDialog roomId={roomId} relation={relation.relation} onClose={() => setRelationDialog(null)} />
      )}
    </Box>
  );
}
