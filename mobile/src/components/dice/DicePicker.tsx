import { useEffect, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { Chip, IconButton, SegmentedButtons, Text, TextInput } from 'react-native-paper';

import { ALLOWED_SIDES } from '../../lib/dice/notation';

type Props = { onChange: (notation: string) => void; initialSides?: number };

/** Monta a notação sem digitar: tipo de dado, quantidade, modificador e vantagem/desvantagem. */
export function DicePicker({ onChange, initialSides = 20 }: Props) {
  const [sides, setSides] = useState(initialSides);
  const [count, setCount] = useState(1);
  const [modifier, setModifier] = useState(0);
  const [advantage, setAdvantage] = useState<'none' | 'adv' | 'dis'>('none');
  const [custom, setCustom] = useState('');

  useEffect(() => {
    if (custom.trim()) return onChange(custom.trim());
    const mod = modifier > 0 ? `+${modifier}` : modifier < 0 ? `${modifier}` : '';
    if (sides === 20 && advantage !== 'none') {
      onChange(`2d20${advantage === 'adv' ? 'kh1' : 'kl1'}${mod}`);
    } else {
      onChange(`${count}d${sides}${mod}`);
    }
  }, [sides, count, modifier, advantage, custom, onChange]);

  return (
    <View style={styles.root}>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
        {ALLOWED_SIDES.map((s) => (
          <Chip key={s} selected={s === sides} showSelectedOverlay onPress={() => setSides(s)} compact>
            {`D${s}`}
          </Chip>
        ))}
      </ScrollView>
      <View style={styles.row}>
        <Text variant="labelLarge">Qtd.</Text>
        <IconButton icon="minus" size={18} onPress={() => setCount(Math.max(1, count - 1))} accessibilityLabel="Menos dados" />
        <Text variant="titleMedium">{count}</Text>
        <IconButton icon="plus" size={18} onPress={() => setCount(Math.min(20, count + 1))} accessibilityLabel="Mais dados" />
        <Text variant="labelLarge" style={{ marginLeft: 8 }}>
          Mod.
        </Text>
        <IconButton icon="minus" size={18} onPress={() => setModifier(modifier - 1)} accessibilityLabel="Diminuir modificador" />
        <Text variant="titleMedium">{modifier >= 0 ? `+${modifier}` : modifier}</Text>
        <IconButton icon="plus" size={18} onPress={() => setModifier(modifier + 1)} accessibilityLabel="Aumentar modificador" />
      </View>
      {sides === 20 ? (
        <SegmentedButtons
          value={advantage}
          onValueChange={(v) => setAdvantage(v as typeof advantage)}
          density="small"
          buttons={[
            { value: 'dis', label: 'Desvantagem' },
            { value: 'none', label: 'Normal' },
            { value: 'adv', label: 'Vantagem' },
          ]}
        />
      ) : null}
      <TextInput
        mode="outlined"
        dense
        label="Ou digite (ex.: 4d6kh3, 1d8+1d6+2)"
        value={custom}
        onChangeText={setCustom}
        autoCapitalize="none"
        autoCorrect={false}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { gap: 8 },
  chips: { gap: 6, paddingVertical: 2 },
  row: { flexDirection: 'row', alignItems: 'center' },
});
