import type { ReactNode } from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  type StyleProp,
  type TextInputProps,
  type ViewStyle,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { BottomTabInset, MaxContentWidth, Spacing } from '@/constants/theme';
import type { Issue } from '@/core/parser/assignmentParser';
import { useTheme } from '@/hooks/use-theme';

type Tone = 'default' | 'warning' | 'danger' | 'success';

export function Screen({
  children,
  tabs = false,
  scroll = true,
}: {
  children: ReactNode;
  /** True for tab screens, to leave room for the tab bar. */
  tabs?: boolean;
  scroll?: boolean;
}) {
  const colors = useTheme();
  const content = (
    <View style={[styles.content, { paddingBottom: (tabs ? BottomTabInset : 0) + Spacing.five }]}>{children}</View>
  );
  return (
    <SafeAreaView
      style={[styles.fill, { backgroundColor: colors.background }]}
      edges={tabs ? ['top', 'left', 'right'] : ['left', 'right']}>
      {scroll ? (
        <ScrollView keyboardShouldPersistTaps="handled" contentInsetAdjustmentBehavior="automatic">
          {content}
        </ScrollView>
      ) : (
        content
      )}
    </SafeAreaView>
  );
}

export function Header({ title, subtitle, right }: { title: string; subtitle?: string; right?: ReactNode }) {
  const colors = useTheme();
  return (
    <View style={styles.header}>
      <View style={styles.fill}>
        <Text accessibilityRole="header" style={[styles.headerTitle, { color: colors.text }]}>
          {title}
        </Text>
        {subtitle ? <Text style={[styles.small, { color: colors.textSecondary }]}>{subtitle}</Text> : null}
      </View>
      {right}
    </View>
  );
}

export function Section({ title, right, children }: { title: string; right?: ReactNode; children: ReactNode }) {
  const colors = useTheme();
  return (
    <View style={styles.section}>
      <View style={styles.row}>
        <Text accessibilityRole="header" style={[styles.sectionTitle, { color: colors.textSecondary }]}>
          {title.toUpperCase()}
        </Text>
        <View style={styles.fill} />
        {right}
      </View>
      {children}
    </View>
  );
}

export function Card({ children, tone = 'default', style }: { children: ReactNode; tone?: Tone; style?: StyleProp<ViewStyle> }) {
  const colors = useTheme();
  const toneBorder = { default: colors.border, warning: colors.warning, danger: colors.danger, success: colors.success }[tone];
  return (
    <View
      style={[
        styles.card,
        { backgroundColor: colors.backgroundElement, borderColor: toneBorder, borderWidth: tone === 'default' ? StyleSheet.hairlineWidth : 1.5 },
        style,
      ]}>
      {children}
    </View>
  );
}

export function Body({ children, muted = false, bold = false, size = 16 }: { children: ReactNode; muted?: boolean; bold?: boolean; size?: number }) {
  const colors = useTheme();
  return (
    <Text style={{ color: muted ? colors.textSecondary : colors.text, fontSize: size, lineHeight: size * 1.35, fontWeight: bold ? '700' : '400' }}>
      {children}
    </Text>
  );
}

export function Title({ children }: { children: ReactNode }) {
  const colors = useTheme();
  return <Text style={[styles.cardTitle, { color: colors.text }]}>{children}</Text>;
}

type ButtonVariant = 'primary' | 'secondary' | 'danger' | 'ghost';

export function Button({
  title,
  onPress,
  variant = 'secondary',
  disabled = false,
  small = false,
  accessibilityLabel,
}: {
  title: string;
  onPress: () => void;
  variant?: ButtonVariant;
  disabled?: boolean;
  small?: boolean;
  accessibilityLabel?: string;
}) {
  const colors = useTheme();
  const bg = { primary: colors.tint, secondary: colors.backgroundSelected, danger: colors.dangerSoft, ghost: 'transparent' }[variant];
  const fg = { primary: colors.onTint, secondary: colors.text, danger: colors.danger, ghost: colors.tint }[variant];
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? title}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.button,
        small && styles.buttonSmall,
        { backgroundColor: bg, opacity: disabled ? 0.45 : pressed ? 0.75 : 1 },
      ]}>
      <Text style={[styles.buttonText, small && styles.buttonTextSmall, { color: fg }]}>{title}</Text>
    </Pressable>
  );
}

export function ButtonRow({ children }: { children: ReactNode }) {
  return <View style={styles.buttonRow}>{children}</View>;
}

export function Pill({ text, tone = 'default' }: { text: string; tone?: Tone }) {
  const colors = useTheme();
  const map = {
    default: [colors.backgroundSelected, colors.textSecondary],
    warning: [colors.warningSoft, colors.warning],
    danger: [colors.dangerSoft, colors.danger],
    success: [colors.successSoft, colors.success],
  } as const;
  const [bg, fg] = map[tone];
  return (
    <View style={[styles.pill, { backgroundColor: bg }]}>
      <Text style={[styles.pillText, { color: fg }]}>{text}</Text>
    </View>
  );
}

export function Field({
  label,
  hint,
  error,
  ...input
}: TextInputProps & { label: string; hint?: string; error?: string | null }) {
  const colors = useTheme();
  return (
    <View style={styles.field}>
      <Text style={[styles.fieldLabel, { color: colors.textSecondary }]}>{label}</Text>
      <TextInput
        placeholderTextColor={colors.textSecondary}
        accessibilityLabel={label}
        {...input}
        style={[
          styles.input,
          input.multiline && styles.inputMultiline,
          { color: colors.text, backgroundColor: colors.background, borderColor: error ? colors.danger : colors.border },
        ]}
      />
      {error ? <Text style={[styles.small, { color: colors.danger }]}>{error}</Text> : null}
      {hint && !error ? <Text style={[styles.small, { color: colors.textSecondary }]}>{hint}</Text> : null}
    </View>
  );
}

export function Segmented<T extends string>({
  options,
  value,
  onChange,
  label,
}: {
  options: { value: T; label: string }[];
  value: T;
  onChange: (value: T) => void;
  label?: string;
}) {
  const colors = useTheme();
  return (
    <View style={styles.field}>
      {label ? <Text style={[styles.fieldLabel, { color: colors.textSecondary }]}>{label}</Text> : null}
      <View style={[styles.segmented, { backgroundColor: colors.backgroundSelected }]} accessibilityRole="radiogroup">
        {options.map((o) => {
          const selected = o.value === value;
          return (
            <Pressable
              key={o.value}
              accessibilityRole="radio"
              accessibilityState={{ selected }}
              onPress={() => onChange(o.value)}
              style={[styles.segment, selected && { backgroundColor: colors.background }]}>
              <Text style={[styles.segmentText, { color: colors.text, fontWeight: selected ? '700' : '500' }]}>{o.label}</Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

export function IssueList({ issues }: { issues: Issue[] }) {
  const colors = useTheme();
  if (!issues.length) return null;
  return (
    <View style={styles.issues}>
      {issues.map((issue, i) => {
        const isError = issue.severity === 'error';
        return (
          <View
            key={`${issue.code}-${i}`}
            style={[styles.issue, { backgroundColor: isError ? colors.dangerSoft : colors.warningSoft }]}>
            <Text style={[styles.small, { color: isError ? colors.danger : colors.warning, fontWeight: '600' }]}>
              {isError ? 'Fix: ' : 'Check: '}
              {issue.message}
            </Text>
          </View>
        );
      })}
    </View>
  );
}

export function Empty({ title, body, children }: { title: string; body?: string; children?: ReactNode }) {
  return (
    <Card>
      <Title>{title}</Title>
      {body ? <Body muted>{body}</Body> : null}
      {children ? <View style={{ marginTop: Spacing.two }}>{children}</View> : null}
    </Card>
  );
}

export function Gap({ size = Spacing.two }: { size?: number }) {
  return <View style={{ height: size }} />;
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  content: {
    paddingHorizontal: Spacing.three,
    paddingTop: Spacing.three,
    gap: Spacing.three,
    width: '100%',
    maxWidth: MaxContentWidth,
    alignSelf: 'center',
  },
  header: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  headerTitle: { fontSize: 30, fontWeight: '700', lineHeight: 36 },
  section: { gap: Spacing.two },
  sectionTitle: { fontSize: 13, fontWeight: '700', letterSpacing: 0.6 },
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  card: { borderRadius: 14, padding: Spacing.three, gap: Spacing.two },
  cardTitle: { fontSize: 18, fontWeight: '700', lineHeight: 24 },
  small: { fontSize: 14, lineHeight: 19 },
  button: {
    minHeight: 44,
    paddingHorizontal: Spacing.three,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    flexGrow: 1,
  },
  buttonSmall: { minHeight: 36, paddingHorizontal: Spacing.two, flexGrow: 0 },
  buttonText: { fontSize: 16, fontWeight: '600' },
  buttonTextSmall: { fontSize: 14 },
  buttonRow: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two },
  pill: { alignSelf: 'flex-start', borderRadius: 999, paddingHorizontal: 10, paddingVertical: 3 },
  pillText: { fontSize: 13, fontWeight: '700' },
  field: { gap: Spacing.one },
  fieldLabel: { fontSize: 13, fontWeight: '600' },
  input: {
    minHeight: 44,
    borderWidth: StyleSheet.hairlineWidth * 2,
    borderRadius: 10,
    paddingHorizontal: Spacing.two + 2,
    paddingVertical: Spacing.two,
    fontSize: 16,
  },
  inputMultiline: { minHeight: 120, textAlignVertical: 'top' },
  segmented: { flexDirection: 'row', borderRadius: 10, padding: 3 },
  segment: { flex: 1, minHeight: 38, alignItems: 'center', justifyContent: 'center', borderRadius: 8, paddingHorizontal: 4 },
  segmentText: { fontSize: 14, textAlign: 'center' },
  issues: { gap: Spacing.one },
  issue: { borderRadius: 8, paddingHorizontal: Spacing.two, paddingVertical: 6 },
});
