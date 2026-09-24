import { StyleSheet, View } from 'react-native';
import { Card, Chip, Text, TextInput, useTheme } from 'react-native-paper';

export type Option = { key: string; name: string; description?: string; tags?: string[] };

type Props = {
  options: Option[];
  selected: string | null;
  onSelect: (key: string) => void;
  allowCustom?: boolean;
  customName?: string;
  onCustomName?: (name: string) => void;
};

/** Lista de escolhas grandes e tocáveis (48dp+), com descrição curta: decide rápido, sem ler o livro. */
export function OptionList({ options, selected, onSelect, allowCustom, customName, onCustomName }: Props) {
  const theme = useTheme();
  return (
    <View style={styles.root}>
      {options.map((o) => {
        const active = selected === o.key;
        return (
          <Card
            key={o.key}
            mode={active ? 'contained' : 'outlined'}
            onPress={() => onSelect(o.key)}
            style={active ? { borderColor: theme.colors.primary, borderWidth: 2 } : undefined}
            accessibilityState={{ selected: active }}
          >
            <Card.Title title={o.name} subtitle={o.description} subtitleNumberOfLines={2} />
            {o.tags && o.tags.length > 0 ? (
              <Card.Content style={styles.tags}>
                {o.tags.map((t) => (
                  <Chip key={t} compact>
                    {t}
                  </Chip>
                ))}
              </Card.Content>
            ) : null}
          </Card>
        );
      })}
      {allowCustom ? (
        <Card mode={selected === 'custom' ? 'contained' : 'outlined'} onPress={() => onSelect('custom')}>
          <Card.Title title="Personalizado" subtitle="Homebrew ou algo fora da lista" />
          {selected === 'custom' && onCustomName ? (
            <Card.Content>
              <TextInput mode="outlined" label="Nome" value={customName ?? ''} onChangeText={onCustomName} maxLength={60} />
            </Card.Content>
          ) : null}
        </Card>
      ) : null}
      {options.length === 0 && !allowCustom ? <Text>Nenhuma opção neste sistema.</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { gap: 10 },
  tags: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
});
