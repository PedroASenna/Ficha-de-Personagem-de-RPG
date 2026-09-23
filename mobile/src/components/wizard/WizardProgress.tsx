import { StyleSheet, View } from 'react-native';
import { ProgressBar, Text, useTheme } from 'react-native-paper';

type Props = { steps: string[]; current: number };

export function WizardProgress({ steps, current }: Props) {
  const theme = useTheme();
  return (
    <View style={styles.root} accessibilityRole="header" accessibilityLabel={`Passo ${current + 1} de ${steps.length}: ${steps[current]}`}>
      <View style={styles.row}>
        <Text variant="titleLarge">{steps[current]}</Text>
        <Text variant="labelLarge" style={{ color: theme.colors.onSurfaceVariant }}>
          {current + 1}/{steps.length}
        </Text>
      </View>
      <ProgressBar progress={(current + 1) / steps.length} color={theme.colors.primary} />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { gap: 8 },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline' },
});
