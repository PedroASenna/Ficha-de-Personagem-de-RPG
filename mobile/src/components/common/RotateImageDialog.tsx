/** Ajuste do ângulo de uma foto antes de enviar (o servidor gira; a prévia mostra o corte redondo). */
import { useState } from 'react';
import { Image, StyleSheet, View } from 'react-native';
import { Button, Dialog, Portal, Text } from 'react-native-paper';

type Props = {
  uri: string | null;
  busy?: boolean;
  onCancel: () => void;
  onConfirm: (rotation: number) => void;
};

const STEPS = [-90, -15, -5, 5, 15, 90];

export function normalizeAngle(degrees: number): number {
  return ((((degrees + 180) % 360) + 360) % 360) - 180;
}

export function RotateImageDialog({ uri, busy = false, onCancel, onConfirm }: Props) {
  const [rotation, setRotation] = useState(0);
  return (
    <Portal>
      <Dialog visible={!!uri} onDismiss={onCancel}>
        <Dialog.Title>Ajustar o ângulo</Dialog.Title>
        <Dialog.Content style={styles.content}>
          <View style={styles.circle}>
            {uri ? (
              <Image source={{ uri }} style={[styles.photo, { transform: [{ rotate: `${rotation}deg` }] }]} accessibilityLabel="Prévia do retrato" />
            ) : null}
          </View>
          <Text variant="titleMedium" testID="rotation-value">
            {rotation}°
          </Text>
          <View style={styles.steps}>
            {STEPS.map((step) => (
              <Button key={step} compact mode="outlined" onPress={() => setRotation((r) => normalizeAngle(r + step))} accessibilityLabel={`Girar ${step} graus`}>
                {step > 0 ? `+${step}°` : `${step}°`}
              </Button>
            ))}
          </View>
        </Dialog.Content>
        <Dialog.Actions>
          <Button onPress={onCancel}>Cancelar</Button>
          <Button mode="contained" loading={busy} disabled={busy} onPress={() => onConfirm(rotation)}>
            Usar foto
          </Button>
        </Dialog.Actions>
      </Dialog>
    </Portal>
  );
}

const styles = StyleSheet.create({
  content: { alignItems: 'center', gap: 12 },
  circle: { width: 180, height: 180, borderRadius: 90, overflow: 'hidden', backgroundColor: '#2A221C' },
  photo: { width: 180, height: 180 },
  steps: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: 6 },
});
