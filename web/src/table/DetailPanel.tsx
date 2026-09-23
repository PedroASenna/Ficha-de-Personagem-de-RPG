import CasinoIcon from "@mui/icons-material/Casino";
import DeleteIcon from "@mui/icons-material/DeleteOutlined";
import EditIcon from "@mui/icons-material/EditOutlined";
import LockIcon from "@mui/icons-material/LockOutlined";
import ShieldIcon from "@mui/icons-material/Shield";
import Avatar from "@mui/material/Avatar";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import ButtonBase from "@mui/material/ButtonBase";
import Chip from "@mui/material/Chip";
import Divider from "@mui/material/Divider";
import FormControlLabel from "@mui/material/FormControlLabel";
import LinearProgress from "@mui/material/LinearProgress";
import MenuItem from "@mui/material/MenuItem";
import Stack from "@mui/material/Stack";
import Switch from "@mui/material/Switch";
import TextField from "@mui/material/TextField";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";
import { useQuery } from "@tanstack/react-query";
import { type FormEvent, type ReactNode, useState } from "react";

import { api } from "../api/client";
import type { CharacterSheet, Npc, PartyMember, Token } from "../api/types";
import { toast } from "../toasts";
import { deleteNpc, removeToken, updateToken } from "./actions";
import { NpcDialog } from "./NpcDialog";
import { type RulesetAttribute, useRuleset } from "./ruleset";
import { abilityModifier, checkNotation, CONDITION_COLOR, formatModifier, hpColor, hpRatio } from "./rules";
import { type ClientMessage, newRequestId, useTable } from "./store";

type Target = { character_id: string } | { npc_id: string };

function sendOrWarn(message: ClientMessage) {
  if (!useTable.getState().send(message)) toast.error("Sem conexão com a mesa. Tentando reconectar…");
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <Box sx={{ mt: 2 }}>
      <Typography variant="overline" color="text.secondary" sx={{ lineHeight: 2 }}>
        {title}
      </Typography>
      {children}
    </Box>
  );
}

function HpBlock({ current, max, temp }: { current: number; max: number; temp: number }) {
  const ratio = hpRatio(current, max);
  return (
    <Box>
      <Stack direction="row" sx={{ alignItems: "baseline", gap: 1 }}>
        <Typography variant="h4" component="span" sx={{ color: hpColor(ratio) }} data-testid="hp-current">
          {current}
        </Typography>
        <Typography color="text.secondary">/ {max} PV</Typography>
        {temp > 0 && <Chip size="small" color="info" label={`+${temp} temporários`} />}
      </Stack>
      <LinearProgress
        variant="determinate"
        value={ratio * 100}
        sx={{
          height: 10,
          borderRadius: 5,
          bgcolor: "rgba(255,255,255,0.08)",
          "& .MuiLinearProgress-bar": { bgcolor: hpColor(ratio), transition: "transform 400ms ease" },
        }}
      />
    </Box>
  );
}

function HpControls({ target }: { target: Target }) {
  const [amount, setAmount] = useState(1);
  const apply = (kind: "damage" | "heal" | "temp") => {
    if (amount < 1) return;
    sendOrWarn({ type: "hp.change", kind, delta: amount, ...target });
  };
  return (
    <Stack direction="row" spacing={1} sx={{ mt: 1.5, alignItems: "center" }}>
      <TextField
        size="small"
        type="number"
        label="Valor"
        value={amount}
        onChange={(e) => setAmount(Math.max(0, Number(e.target.value)))}
        slotProps={{ htmlInput: { min: 1, max: 9999, "aria-label": "Valor de dano ou cura" } }}
        sx={{ width: 90 }}
      />
      <Button variant="contained" color="error" onClick={() => apply("damage")}>
        Dano
      </Button>
      <Button variant="contained" color="success" onClick={() => apply("heal")}>
        Cura
      </Button>
      <Tooltip title="PV temporários">
        <Button variant="outlined" onClick={() => apply("temp")}>
          Temp
        </Button>
      </Tooltip>
    </Stack>
  );
}

function AttributeGrid({
  attributes,
  values,
  onRoll,
}: {
  attributes: RulesetAttribute[];
  values: Record<string, number>;
  onRoll: (attr: RulesetAttribute, score: number) => void;
}) {
  const known =
    attributes.length > 0
      ? attributes
      : Object.keys(values).map((key) => ({ key, name: key, abbr: key.toUpperCase() }));
  return (
    <Box sx={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 1 }}>
      {known.map((attr) => {
        const score = values[attr.key] ?? 10;
        return (
          <Tooltip key={attr.key} title={`Rolar ${attr.name} (${checkNotation(score)})`}>
            <ButtonBase
              onClick={() => onRoll(attr, score)}
              sx={{
                flexDirection: "column",
                py: 1,
                borderRadius: 2,
                border: 1,
                borderColor: "divider",
                bgcolor: "rgba(0,0,0,0.2)",
                "&:hover": { borderColor: "primary.main" },
              }}
            >
              <Typography variant="caption" color="text.secondary">
                {attr.abbr}
              </Typography>
              <Typography variant="h6" sx={{ lineHeight: 1.1 }}>
                {formatModifier(abilityModifier(score))}
              </Typography>
              <Typography variant="caption" color="text.disabled">
                {score}
              </Typography>
            </ButtonBase>
          </Tooltip>
        );
      })}
    </Box>
  );
}

function RollBox({ target, secretByDefault }: { target: Target; secretByDefault: boolean }) {
  const [notation, setNotation] = useState("1d20");
  const [secret, setSecret] = useState(secretByDefault);
  const submit = (event: FormEvent) => {
    event.preventDefault();
    sendOrWarn({
      type: "roll.request",
      id: newRequestId(),
      notation: notation.trim(),
      visibility: secret ? "master_only" : "public",
      ...target,
    });
  };
  return (
    <Stack component="form" onSubmit={submit} direction="row" spacing={1} sx={{ alignItems: "center", mt: 1 }}>
      <TextField
        size="small"
        label="Rolar"
        value={notation}
        onChange={(e) => setNotation(e.target.value)}
        placeholder="1d20+4, 2d6+3…"
        sx={{ flex: 1 }}
      />
      <Tooltip title={secret ? "Só você vê o resultado" : "Todos veem o resultado"}>
        <FormControlLabel
          sx={{ mr: 0 }}
          control={<Switch size="small" checked={secret} onChange={(e) => setSecret(e.target.checked)} />}
          label={<LockIcon fontSize="small" color={secret ? "primary" : "disabled"} />}
        />
      </Tooltip>
      <Button type="submit" variant="outlined" startIcon={<CasinoIcon />} disabled={!notation.trim()}>
        Rolar
      </Button>
    </Stack>
  );
}

function TokenControls({ token }: { token: Token }) {
  const scenes = useTable((s) => s.scenes);
  return (
    <Section title="No mapa">
      <FormControlLabel
        control={
          <Switch checked={!token.hidden} onChange={(e) => void updateToken(token.id, { hidden: !e.target.checked })} />
        }
        label={token.hidden ? "Escondido dos jogadores" : "Visível para os jogadores"}
      />
      <Stack direction="row" spacing={1} sx={{ mt: 1 }}>
        <TextField
          select
          size="small"
          label="Cena"
          value={token.scene_id}
          onChange={(e) => void updateToken(token.id, { scene_id: e.target.value })}
          sx={{ flex: 1 }}
        >
          {scenes.map((s) => (
            <MenuItem key={s.id} value={s.id}>
              {s.name}
            </MenuItem>
          ))}
        </TextField>
        <TextField
          select
          size="small"
          label="Tamanho"
          value={token.size}
          onChange={(e) => void updateToken(token.id, { size: Number(e.target.value) })}
          sx={{ width: 110 }}
        >
          {[0.5, 1, 2, 3, 4].map((size) => (
            <MenuItem key={size} value={size}>
              {size === 0.5 ? "½" : size}
            </MenuItem>
          ))}
        </TextField>
      </Stack>
      <Button size="small" color="error" sx={{ mt: 1 }} onClick={() => void removeToken(token.id)}>
        Tirar do mapa
      </Button>
    </Section>
  );
}

function CharacterDetail({ member, token }: { member: PartyMember; token: Token | null }) {
  const room = useTable((s) => s.room);
  const ruleset = useRuleset(room?.ruleset_id);
  const sheet = useQuery({
    queryKey: ["sheet", room?.id, member.id, member.version],
    queryFn: () => api<CharacterSheet>(`/rooms/${room?.id}/characters/${member.id}`),
    enabled: Boolean(room),
    refetchInterval: 15_000,
    placeholderData: (previous) => previous,
  });
  const data = sheet.data;
  const roll = (attr: RulesetAttribute, score: number) =>
    sendOrWarn({
      type: "roll.request",
      id: newRequestId(),
      notation: checkNotation(score, ruleset.data?.dice.default_check),
      label: attr.name,
      visibility: "public",
      character_id: member.id,
    });

  return (
    <Box>
      <Stack direction="row" spacing={2} sx={{ alignItems: "center" }}>
        <Avatar
          src={member.portrait_url ?? undefined}
          sx={{ width: 64, height: 64, border: 3, borderColor: "secondary.main" }}
        >
          {member.name[0]}
        </Avatar>
        <Box sx={{ minWidth: 0 }}>
          <Typography variant="h5" noWrap>
            {member.name}
          </Typography>
          <Typography variant="body2" color="text.secondary">
            {[member.ancestry_name, member.class_name, `Nível ${member.level}`].filter(Boolean).join(" · ")}
          </Typography>
          {data?.background_name && (
            <Typography variant="caption" color="text.disabled">
              {data.background_name}
            </Typography>
          )}
        </Box>
      </Stack>
      <Box sx={{ mt: 2 }}>
        <HpBlock current={member.hp_current} max={member.hp_max} temp={member.hp_temp} />
        <HpControls target={{ character_id: member.id }} />
      </Box>
      {data && (
        <>
          <Section title="Atributos (clique para rolar)">
            <AttributeGrid attributes={ruleset.data?.attributes ?? []} values={data.attributes} onRoll={roll} />
          </Section>
          {data.conditions.length > 0 && (
            <Section title="Condições">
              <Stack direction="row" spacing={0.5} useFlexGap sx={{ flexWrap: "wrap" }}>
                {data.conditions.map((c) => (
                  <Chip key={c} size="small" label={c} color="warning" variant="outlined" />
                ))}
              </Stack>
            </Section>
          )}
          {data.abilities.length > 0 && (
            <Section title="Magias e habilidades">
              {data.abilities.map((a) => (
                <Stack
                  key={a.id}
                  direction="row"
                  sx={{ justifyContent: "space-between", opacity: a.available ? 1 : 0.5 }}
                >
                  <Typography variant="body2">
                    {a.name}
                    {a.level > 0 ? ` (nv ${a.level})` : ""}
                  </Typography>
                  <Typography variant="body2" color={a.available ? "text.secondary" : "error"}>
                    {a.uses_max - a.uses_spent}/{a.uses_max}
                  </Typography>
                </Stack>
              ))}
            </Section>
          )}
          <Section title={`Inventário · ${data.load.total_weight}/${data.load.capacity} ${data.load.unit}`}>
            {data.load.encumbered && (
              <Typography variant="body2" color="warning.main">
                Sobrecarregado
              </Typography>
            )}
            {data.items.length === 0 && (
              <Typography variant="body2" color="text.disabled">
                Mochila vazia
              </Typography>
            )}
            {data.items.map((item) => (
              <Typography key={item.id} variant="body2">
                {item.quantity > 1 ? `${item.quantity}× ` : ""}
                {item.name}
                {item.equipped ? " (equipado)" : ""}
              </Typography>
            ))}
          </Section>
          {data.notes && (
            <Section title="Anotações do jogador">
              <Typography variant="body2" sx={{ whiteSpace: "pre-wrap" }}>
                {data.notes}
              </Typography>
            </Section>
          )}
        </>
      )}
      <Section title="Rolar pelo personagem">
        <RollBox target={{ character_id: member.id }} secretByDefault={false} />
      </Section>
      {token && <TokenControls token={token} />}
    </Box>
  );
}

function NpcDetail({ npc, token }: { npc: Npc; token: Token | null }) {
  const room = useTable((s) => s.room);
  const ruleset = useRuleset(room?.ruleset_id);
  const [editing, setEditing] = useState(false);
  const roll = (attr: RulesetAttribute, score: number) =>
    sendOrWarn({
      type: "roll.request",
      id: newRequestId(),
      notation: checkNotation(score, ruleset.data?.dice.default_check),
      label: attr.name,
      visibility: "master_only",
      npc_id: npc.id,
    });

  return (
    <Box>
      <Stack direction="row" spacing={2} sx={{ alignItems: "center" }}>
        <Avatar
          src={npc.portrait_url ?? undefined}
          sx={{ width: 64, height: 64, border: 3, borderColor: "error.main" }}
        >
          {npc.name[0]}
        </Avatar>
        <Box sx={{ minWidth: 0, flex: 1 }}>
          <Typography variant="h5" noWrap>
            {npc.name}
          </Typography>
          <Stack direction="row" spacing={1} sx={{ alignItems: "center" }}>
            <Typography variant="caption" color="text.secondary">
              Jogadores veem:
            </Typography>
            <Chip
              size="small"
              label={npc.condition_label}
              sx={{ bgcolor: CONDITION_COLOR[npc.condition], color: "#14100d", height: 20 }}
            />
          </Stack>
        </Box>
        {npc.armor_class !== null && (
          <Tooltip title="Classe de Armadura">
            <Box sx={{ position: "relative", display: "grid", placeItems: "center" }}>
              <ShieldIcon sx={{ fontSize: 48, color: "rgba(212,166,74,0.25)" }} />
              <Typography sx={{ position: "absolute", fontWeight: 700 }}>{npc.armor_class}</Typography>
            </Box>
          </Tooltip>
        )}
      </Stack>
      <Box sx={{ mt: 2 }}>
        <HpBlock current={npc.hp_current} max={npc.hp_max} temp={npc.hp_temp} />
        <HpControls target={{ npc_id: npc.id }} />
        <Typography variant="caption" color="text.disabled">
          Os números ficam só com você; os jogadores veem o estado mudar.
        </Typography>
      </Box>
      {Object.keys(npc.attributes).length > 0 && (
        <Section title="Atributos (rolagem secreta)">
          <AttributeGrid attributes={ruleset.data?.attributes ?? []} values={npc.attributes} onRoll={roll} />
        </Section>
      )}
      <Section title="Ataque / rolagem">
        <RollBox target={{ npc_id: npc.id }} secretByDefault />
      </Section>
      {npc.notes && (
        <Section title="Anotações">
          <Typography variant="body2" sx={{ whiteSpace: "pre-wrap" }}>
            {npc.notes}
          </Typography>
        </Section>
      )}
      {token && <TokenControls token={token} />}
      <Divider sx={{ my: 2 }} />
      <Stack direction="row" spacing={1}>
        <Button startIcon={<EditIcon />} onClick={() => setEditing(true)}>
          Editar
        </Button>
        <Button
          color="error"
          startIcon={<DeleteIcon />}
          onClick={() => window.confirm(`Apagar ${npc.name}? Ele sai de todas as cenas.`) && void deleteNpc(npc.id)}
        >
          Apagar inimigo
        </Button>
      </Stack>
      {room && <NpcDialog open={editing} roomId={room.id} npc={npc} onClose={() => setEditing(false)} />}
    </Box>
  );
}

export function DetailPanel() {
  const selection = useTable((s) => s.selection);
  const npc = useTable((s) => (s.selection?.kind === "npc" ? s.npcs[s.selection.id] : undefined));
  const member = useTable((s) =>
    s.selection?.kind === "character" ? s.party.find((p) => p.id === s.selection?.id) : undefined,
  );
  const token = useTable((s) => (s.selection?.tokenId ? (s.tokens[s.selection.tokenId] ?? null) : null));

  if (!selection || (!npc && !member)) {
    return (
      <Box sx={{ p: 3, color: "text.secondary", textAlign: "center" }}>
        <Typography variant="h6" gutterBottom>
          Nada selecionado
        </Typography>
        <Typography variant="body2">
          Clique num boneco no mapa (ou na lista à esquerda) para ver os atributos em tempo real, aplicar dano e cura ou
          rolar por ele.
        </Typography>
      </Box>
    );
  }
  return (
    <Box sx={{ p: 2 }} data-testid="detail-panel">
      {npc ? (
        <NpcDetail key={npc.id} npc={npc} token={token} />
      ) : (
        member && <CharacterDetail key={member.id} member={member} token={token} />
      )}
    </Box>
  );
}
