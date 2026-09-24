import Button from "@mui/material/Button";
import Dialog from "@mui/material/Dialog";
import DialogActions from "@mui/material/DialogActions";
import DialogContent from "@mui/material/DialogContent";
import DialogTitle from "@mui/material/DialogTitle";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import { type FormEvent, useState } from "react";

import type { Npc } from "../api/types";
import { createNpcs, updateNpc } from "./actions";
import { ImagePicker } from "./ImagePicker";
import { useRuleset } from "./ruleset";
import { abilityModifier, formatModifier } from "./rules";
import { useTable } from "./store";

interface Props {
  roomId: string;
  npc: Npc | null; // null = novo inimigo
  onClose: () => void;
}

function NpcForm({ roomId, npc, onClose }: Props) {
  const rulesetId = useTable((s) => s.room?.ruleset_id);
  const ruleset = useRuleset(rulesetId);
  const [name, setName] = useState(npc?.name ?? "");
  const [portrait, setPortrait] = useState<{ key: string | null; url: string | null }>({
    key: npc?.portrait_key ?? null,
    url: npc?.portrait_url ?? null,
  });
  const [hpMax, setHpMax] = useState(npc?.hp_max ?? 10);
  const [armorClass, setArmorClass] = useState<string>(npc?.armor_class?.toString() ?? "");
  const [attributes, setAttributes] = useState<Record<string, number>>(npc?.attributes ?? {});
  const [notes, setNotes] = useState(npc?.notes ?? "");
  const [count, setCount] = useState(1);
  const [busy, setBusy] = useState(false);

  const attrs = ruleset.data?.attributes ?? [];
  const engine = ruleset.data?.engine;
  // Savage Worlds: atributos em tipo de dado (d4 a d12); o resto começa na média 10.
  const base = engine === "savage" ? 6 : 10;

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    const body = {
      name: name.trim(),
      portrait_key: portrait.key,
      hp_max: hpMax,
      armor_class: armorClass === "" ? null : Number(armorClass),
      attributes: Object.fromEntries(attrs.map((a) => [a.key, attributes[a.key] ?? base])),
      notes,
    };
    const saved = npc ? await updateNpc(npc.id, body) : await createNpcs(roomId, { ...body, count });
    setBusy(false);
    if (saved) onClose();
  };

  return (
    <form onSubmit={(e) => void submit(e)}>
      <DialogTitle>{npc ? `Editar ${npc.name}` : "Novo inimigo"}</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ pt: 1 }}>
          <Stack direction="row" spacing={2} sx={{ alignItems: "center" }}>
            <ImagePicker
              roomId={roomId}
              kind="token"
              round
              label="Imagem"
              previewUrl={portrait.url}
              onUploaded={(image) => setPortrait({ key: image.key, url: image.url })}
            />
            <Stack spacing={2} sx={{ flex: 1 }}>
              <TextField
                label="Nome"
                placeholder="Goblin, Lobo, Capitão da guarda…"
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
                autoFocus
                slotProps={{ htmlInput: { maxLength: 50 } }}
              />
              <Stack direction="row" spacing={2}>
                <TextField
                  label="PV máximos"
                  type="number"
                  value={hpMax}
                  onChange={(e) => setHpMax(Number(e.target.value))}
                  slotProps={{ htmlInput: { min: 1, max: 99999 } }}
                  required
                  sx={{ flex: 1 }}
                />
                <TextField
                  label="CA"
                  type="number"
                  value={armorClass}
                  onChange={(e) => setArmorClass(e.target.value)}
                  slotProps={{ htmlInput: { min: 0, max: 99, "aria-label": "Classe de Armadura" } }}
                  helperText={engine === "savage" ? "Aparar" : engine === "gurps" ? "Defesa" : "Classe de Armadura"}
                  sx={{ flex: 1 }}
                />
                {!npc && (
                  <TextField
                    label="Quantos?"
                    type="number"
                    value={count}
                    onChange={(e) => setCount(Number(e.target.value))}
                    slotProps={{ htmlInput: { min: 1, max: 30 } }}
                    helperText={count > 1 ? `${name || "Inimigo"} 1…${count}` : " "}
                    sx={{ flex: 1 }}
                  />
                )}
              </Stack>
            </Stack>
          </Stack>
          {attrs.length > 0 && (
            <>
              <Typography variant="subtitle2" color="text.secondary">
                Atributos
              </Typography>
              <Stack direction="row" spacing={1} useFlexGap sx={{ flexWrap: "wrap" }}>
                {attrs.map((attr) => {
                  const value = attributes[attr.key] ?? base;
                  return (
                    <TextField
                      key={attr.key}
                      label={attr.abbr}
                      type="number"
                      value={value}
                      onChange={(e) => setAttributes({ ...attributes, [attr.key]: Number(e.target.value) })}
                      helperText={
                        engine === "savage"
                          ? `d${value}`
                          : engine === "gurps"
                            ? `3d6 ≤ ${value}`
                            : formatModifier(abilityModifier(value))
                      }
                      slotProps={{
                        htmlInput:
                          engine === "savage"
                            ? { min: 4, max: 12, step: 2, "aria-label": attr.name }
                            : { min: 1, max: 30, "aria-label": attr.name },
                      }}
                      sx={{ width: 84 }}
                    />
                  );
                })}
              </Stack>
            </>
          )}
          <TextField
            label="Anotações (só você vê)"
            placeholder="Ataques, fraquezas, o que ele sabe…"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            multiline
            minRows={3}
            slotProps={{ htmlInput: { maxLength: 5000 } }}
          />
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Cancelar</Button>
        <Button type="submit" variant="contained" disabled={!name.trim() || hpMax < 1} loading={busy}>
          {npc ? "Salvar" : count > 1 ? `Criar ${count}` : "Criar inimigo"}
        </Button>
      </DialogActions>
    </form>
  );
}

export function NpcDialog({ open, ...props }: Props & { open: boolean }) {
  return (
    <Dialog open={open} onClose={props.onClose} fullWidth maxWidth="sm">
      <NpcForm {...props} />
    </Dialog>
  );
}
