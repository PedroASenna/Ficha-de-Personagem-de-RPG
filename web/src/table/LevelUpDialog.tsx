import AddIcon from "@mui/icons-material/Add";
import RemoveIcon from "@mui/icons-material/Remove";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Dialog from "@mui/material/Dialog";
import DialogActions from "@mui/material/DialogActions";
import DialogContent from "@mui/material/DialogContent";
import DialogTitle from "@mui/material/DialogTitle";
import IconButton from "@mui/material/IconButton";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import { useState } from "react";

import type { CharacterSheet } from "../api/types";
import { levelUp } from "./actions";
import { nextLevelRules, type RulesetPack } from "./ruleset";

interface Props {
  roomId: string;
  sheet: CharacterSheet;
  pack: RulesetPack;
  onClose: () => void;
}

/** Subir de nível pela mesa: PV (automáticos ou digitados) e pontos de atributo quando o nível dá. */
export function LevelUpDialog({ roomId, sheet, pack, onClose }: Props) {
  const rules = nextLevelRules(pack, sheet.level);
  const [hpGain, setHpGain] = useState(0);
  const [points, setPoints] = useState<Record<string, number>>({});
  const [busy, setBusy] = useState(false);
  const spent = Object.values(points).reduce((sum, v) => sum + v, 0);
  const valid = rules.free ? spent <= rules.points : spent === 0 || spent === rules.points;

  const bump = (key: string, delta: number) => {
    const current = points[key] ?? 0;
    const next = Math.max(0, current + delta);
    const score = (sheet.attributes[key] ?? 0) + next;
    if (delta > 0 && (spent >= rules.points || (rules.attributeMax !== null && score > rules.attributeMax))) return;
    setPoints({ ...points, [key]: next });
  };

  const submit = async () => {
    setBusy(true);
    const attributes = Object.fromEntries(Object.entries(points).filter(([, v]) => v > 0));
    const saved = await levelUp(roomId, sheet.id, {
      attributes,
      hp_gain: rules.hpAutomatic ? null : hpGain,
      expected_version: sheet.version,
    });
    setBusy(false);
    if (saved) onClose();
  };

  return (
    <Dialog open onClose={onClose} fullWidth maxWidth="xs">
      <DialogTitle>
        {sheet.name}: nível {sheet.level} → {rules.next}
      </DialogTitle>
      <DialogContent>
        {rules.atMax ? (
          <Alert severity="info">Este personagem já está no nível máximo do sistema.</Alert>
        ) : (
          <Stack spacing={2} sx={{ pt: 1 }}>
            {rules.hpAutomatic ? (
              <Typography variant="body2" color="text.secondary">
                Os PV do novo nível são calculados pela classe e pela Constituição.
              </Typography>
            ) : (
              <TextField
                type="number"
                label="PV ganhos neste nível"
                value={hpGain}
                onChange={(e) => setHpGain(Math.min(999, Math.max(0, Number(e.target.value))))}
                slotProps={{ htmlInput: { min: 0, max: 999 } }}
              />
            )}
            {rules.points > 0 ? (
              <Box>
                <Typography variant="body2" gutterBottom>
                  {rules.free
                    ? `Pontos de atributo combinados com a mesa (até ${rules.points}): ${spent}`
                    : `Nível ${rules.next}: distribua ${rules.points} pontos de atributo (${spent}/${rules.points})` +
                      (rules.attributeMax ? `, máximo ${rules.attributeMax} em cada.` : ".")}
                </Typography>
                <Box sx={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 1 }}>
                  {pack.attributes.map((attr) => (
                    <Stack
                      key={attr.key}
                      sx={{ alignItems: "center", border: 1, borderColor: "divider", borderRadius: 2, py: 0.5 }}
                    >
                      <Typography variant="caption" color="text.secondary">
                        {attr.abbr} {(sheet.attributes[attr.key] ?? 0) + (points[attr.key] ?? 0)}
                      </Typography>
                      <Stack direction="row" sx={{ alignItems: "center" }}>
                        <IconButton
                          size="small"
                          aria-label={`Tirar ponto de ${attr.name}`}
                          onClick={() => bump(attr.key, -1)}
                        >
                          <RemoveIcon fontSize="inherit" />
                        </IconButton>
                        <Typography variant="body2" sx={{ minWidth: 20, textAlign: "center" }}>
                          +{points[attr.key] ?? 0}
                        </Typography>
                        <IconButton
                          size="small"
                          aria-label={`Dar ponto a ${attr.name}`}
                          onClick={() => bump(attr.key, 1)}
                        >
                          <AddIcon fontSize="inherit" />
                        </IconButton>
                      </Stack>
                    </Stack>
                  ))}
                </Box>
                {!rules.free && spent === 0 && (
                  <Typography variant="caption" color="text.secondary">
                    Sem pontos agora? Tudo bem: quem pega um talento no lugar anota na ficha.
                  </Typography>
                )}
              </Box>
            ) : (
              <Typography variant="body2" color="text.secondary">
                O nível {rules.next} não dá pontos de atributo neste sistema.
              </Typography>
            )}
          </Stack>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Cancelar</Button>
        <Button variant="contained" disabled={rules.atMax || !valid} loading={busy} onClick={() => void submit()}>
          Subir para o nível {rules.next}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

/** GURPS: pontos de personagem; Savage Worlds: XP (a cada 5, um Progresso que o jogador escolhe no app). */
export function ExperienceDialog({
  roomId,
  sheet,
  engine,
  onClose,
}: {
  roomId: string;
  sheet: CharacterSheet;
  engine: "gurps" | "savage";
  onClose: () => void;
}) {
  const [amount, setAmount] = useState(engine === "gurps" ? 5 : 2);
  const [busy, setBusy] = useState(false);
  const gurps = engine === "gurps";
  const submit = async () => {
    setBusy(true);
    const saved = await levelUp(roomId, sheet.id, { experience: amount, expected_version: sheet.version });
    setBusy(false);
    if (saved) onClose();
  };
  return (
    <Dialog open onClose={onClose} fullWidth maxWidth="xs">
      <DialogTitle>
        {sheet.name}: {gurps ? "dar pontos de personagem" : "dar experiência"}
      </DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ pt: 1 }}>
          <Typography variant="body2" color="text.secondary">
            {gurps
              ? "Os pontos ficam livres na ficha: o jogador gasta no app (atributos, perícias, vantagens ou recomprar desvantagens)."
              : "1 XP: sessão curta ou pouco avanço. 2: mais sucessos que falhas. 3: grande impacto na história. A cada 5 XP o jogador faz um Progresso no app."}
          </Typography>
          <Stack direction="row" spacing={1}>
            {(gurps ? [1, 2, 3, 5, 10] : [1, 2, 3]).map((n) => (
              <Button
                key={n}
                variant={amount === n ? "contained" : "outlined"}
                size="small"
                onClick={() => setAmount(n)}
              >
                +{n}
              </Button>
            ))}
          </Stack>
          <TextField
            type="number"
            label={gurps ? "Pontos" : "XP"}
            value={amount}
            onChange={(e) => setAmount(Math.min(1000, Math.max(1, Number(e.target.value))))}
            slotProps={{ htmlInput: { min: 1, max: 1000 } }}
          />
          <Typography variant="caption" color="text.secondary">
            Hoje: {sheet.level_label}
          </Typography>
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Cancelar</Button>
        <Button variant="contained" loading={busy} disabled={amount < 1} onClick={() => void submit()}>
          Dar {amount} {gurps ? "pontos" : "XP"}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
