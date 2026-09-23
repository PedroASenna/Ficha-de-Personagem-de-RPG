import { useCallback, useState } from 'react';
import { View } from 'react-native';
import { SegmentedButtons, Text, useTheme } from 'react-native-paper';

import { Screen } from '../../components/common/Screen';
import { DicePicker } from '../../components/dice/DicePicker';
import { DiceTray } from '../../components/dice/DiceTray';
import { rollSolo } from '../../lib/dice/roller';

export default function DiceScreen() {
  const theme = useTheme();
  const [notation, setNotation] = useState('1d20');
  const [d6Variant, setD6Variant] = useState<'pips' | 'numeric'>('pips');
  const roll = useCallback((n: string) => rollSolo(n), []);

  return (
    <Screen>
      <DicePicker onChange={setNotation} />
      <DiceTray notation={notation} roll={roll} d6Variant={d6Variant} height={320} />
      <View style={{ gap: 6 }}>
        <Text variant="labelLarge" style={{ color: theme.colors.onSurfaceVariant }}>
          Estilo do D6
        </Text>
        <SegmentedButtons
          value={d6Variant}
          onValueChange={(v) => setD6Variant(v as 'pips' | 'numeric')}
          density="small"
          buttons={[
            { value: 'pips', label: 'Padrão (pontos)' },
            { value: 'numeric', label: 'Numérico' },
          ]}
        />
      </View>
    </Screen>
  );
}
