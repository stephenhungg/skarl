import { useMemo, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { enter } from '../components/motion';
import { Wordmark } from '../components/Mark';
import Animated, { FadeIn, LinearTransition } from 'react-native-reanimated';
import { colors as c, fonts as f, gutter, radius } from '../../theme';
import { money } from '../api';
import { useOpenTasks, type LiveTask } from '../data';
import { useSession } from '../session';
import { Empty, H1, Pill, Section, t } from '../components/Primitives';
import { PressableScale } from '../components/PressableScale';
import { artFor, TaskArt } from '../components/TaskArt';
import { ChevronRight, ClockIcon, ProfileIcon } from '../components/Icons';
import type { RootProps } from '../navigation';

type Chip = 'Category' | 'Pay' | 'Time';
const CHIPS: Chip[] = ['Category', 'Pay', 'Time'];

function TaskCard({ task, onPress, index }: { task: LiveTask; onPress(): void; index: number }) {
  return <Animated.View entering={enter(140 + index * 70, 420)} layout={LinearTransition}>
    <PressableScale accessibilityRole="button" accessibilityLabel={`${task.title}, ${money(task.rateAtomic)} USDC per video`} onPress={onPress} style={s.task}>
      <TaskArt compact kind={artFor(task.title, task.taskSpec?.object)} style={s.thumb} />
      <View style={{ flex: 1, gap: 6 }}>
        <View style={{ flexDirection: 'row', gap: 6, alignItems: 'center' }}>
          <Text style={s.taskCategory}>{task.category}</Text>
          {task.closed && <Pill tone="muted" style={s.newPill}>Closed</Pill>}
        </View>
        <Text numberOfLines={2} style={s.taskTitle}>{task.title}</Text>
        <View style={s.metaRow}>
          <Text style={s.pay}>{money(task.rateAtomic)} USDC</Text>
          <View style={s.sep} />
          <ClockIcon size={13} /><Text style={s.meta}>10 to 30 s</Text>
        </View>
      </View>
      <ChevronRight />
    </PressableScale>
  </Animated.View>;
}

export function TasksScreen({ navigation }: RootProps<'Tasks'>) {
  const insets = useSafeAreaInsets();
  const { tasks, loading } = useOpenTasks();
  const { draft } = useSession();
  const [chip, setChip] = useState<Chip | null>(null);
  const [category, setCategory] = useState<string | null>(null);
  const categories = useMemo(() => [...new Set(tasks.map(item => item.category))].map(name => {
    const items = tasks.filter(item => item.category === name);
    const top = items.reduce((max, item) => BigInt(item.rateAtomic) > max ? BigInt(item.rateAtomic) : max, 0n);
    return { name, title: items[0]?.title, taskSpec: items[0]?.taskSpec, count: items.filter(item => !item.closed).length, top };
  }), [tasks]);
  const visible = useMemo(() => {
    const list = tasks.filter(item => !category || item.category === category);
    if (chip === 'Pay') list.sort((a, b) => Number(BigInt(b.rateAtomic) - BigInt(a.rateAtomic)));
    return list;
  }, [tasks, category, chip]);
  const pendingTake = draft && !draft.attached && !draft.attachmentClosed;

  return <ScrollView style={s.screen} contentContainerStyle={{ paddingTop: insets.top + 12, paddingBottom: insets.bottom + 40, paddingHorizontal: gutter }}>
    <Animated.View entering={FadeIn.duration(400)} style={s.header}>
      <View style={{ flex: 1, gap: 14 }}>
        <Wordmark size={18} />
        <H1>Tasks</H1>
      </View>
      <PressableScale accessibilityRole="button" accessibilityLabel="Profile" onPress={() => navigation.navigate('Profile')} style={s.profile}>
        <ProfileIcon size={20} />
      </PressableScale>
    </Animated.View>

    <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginHorizontal: -gutter, marginTop: 18 }} contentContainerStyle={{ paddingHorizontal: gutter, gap: 8 }}>
      {CHIPS.map(name => {
        const active = name === 'Category' ? !!category : chip === name;
        return <PressableScale key={name} accessibilityRole="button" accessibilityState={{ selected: active }} onPress={() => {
          if (name === 'Category') setCategory(category ? null : categories[0]?.name ?? null);
          else setChip(chip === name ? null : name);
        }} style={[s.chip, active && s.chipActive]}>
          <Text style={[s.chipText, active && { color: c.paper }]}>{name === 'Category' && category ? category : name === 'Pay' && active ? 'Highest pay' : name === 'Time' && active ? 'Shortest' : name}</Text>
          <Text style={[s.chipCaret, active && { color: c.accent }]}>{active ? '×' : '▾'}</Text>
        </PressableScale>;
      })}
    </ScrollView>

    {pendingTake && <Animated.View entering={enter(0, 380)} style={{ marginTop: 18 }}>
      <PressableScale accessibilityRole="button" onPress={() => navigation.navigate('Capture', { consented: true })} style={s.resume}>
        <View style={s.resumeDot} />
        <View style={{ flex: 1 }}>
          <Text style={s.resumeTitle}>Saved take ready to submit</Text>
        </View>
        <ChevronRight color={c.accentInk} />
      </PressableScale>
    </Animated.View>}

    <Section title="Explore by category" />
    {loading ? <View style={[s.categoryCard, s.skeleton]} /> : categories.length ? <View style={s.grid}>
      {categories.map((item, index) => <Animated.View key={item.name} entering={enter(80 + index * 60, 420)} style={{ width: '100%' }}>
        <PressableScale accessibilityRole="button" onPress={() => setCategory(category === item.name ? null : item.name)}
          style={[s.categoryCard, category === item.name && { borderColor: c.ink }]}>
          <TaskArt kind={artFor(item.title, item.taskSpec?.object)} style={s.categoryArt} />
          <View style={{ padding: 14, gap: 4 }}>
            <Text style={s.categoryName}>{item.name}</Text>
            <Text style={s.meta}>{item.count} open {item.count === 1 ? 'task' : 'tasks'} · up to {money(item.top)} USDC</Text>
          </View>
        </PressableScale>
      </Animated.View>)}
    </View> : <Empty title="No categories yet" />}

    <Section title={category ? `${category} tasks` : 'All tasks'} aside={!loading && <Text style={t.meta}>{visible.length} open</Text>} />
    {loading && <View style={{ gap: 10 }}>{[0, 1].map(i => <View key={i} style={[s.task, s.skeleton, { height: 96 }]} />)}</View>}
    {!loading && !visible.length && <Empty title="No open tasks" />}
    <View style={{ gap: 10 }}>
      {visible.map((item, index) => <TaskCard key={item.orderId} task={item} index={index} onPress={() => navigation.navigate('TaskDetail', { orderId: item.orderId })} />)}
    </View>
  </ScrollView>;
}

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: c.paper },
  header: { flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
  profile: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center', marginTop: -10,
    backgroundColor: c.card, borderWidth: StyleSheet.hairlineWidth, borderColor: c.hairline },
  chip: { flexDirection: 'row', alignItems: 'center', gap: 6, height: 38, paddingHorizontal: 15, borderRadius: radius.pill,
    backgroundColor: c.card, borderWidth: StyleSheet.hairlineWidth, borderColor: c.hairline },
  chipActive: { backgroundColor: c.ink, borderColor: c.ink },
  chipText: { fontFamily: f.medium, fontSize: 14, color: c.ink },
  chipCaret: { fontSize: 11, color: c.slate500 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  categoryCard: { borderRadius: radius.card, overflow: 'hidden', backgroundColor: c.card, borderWidth: 1, borderColor: c.hairline },
  categoryArt: { height: 112 },
  categoryName: { fontFamily: f.medium, fontSize: 17, color: c.ink },
  task: { flexDirection: 'row', alignItems: 'center', gap: 14, padding: 12, borderRadius: radius.card, backgroundColor: c.card,
    borderWidth: StyleSheet.hairlineWidth, borderColor: c.hairline },
  thumb: { width: 76, height: 76, borderRadius: 14 },
  taskCategory: { fontFamily: f.mono, fontSize: 11, letterSpacing: 0.5, color: c.slate500, textTransform: 'uppercase' },
  newPill: { paddingVertical: 2, paddingHorizontal: 8 },
  taskTitle: { fontFamily: f.medium, fontSize: 16, lineHeight: 20, color: c.ink },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' },
  pay: { fontFamily: f.medium, fontSize: 14, color: c.positive },
  meta: { fontFamily: f.book, fontSize: 13, color: c.slate500 },
  sep: { width: 3, height: 3, borderRadius: 2, backgroundColor: c.fog },
  skeleton: { height: 170, backgroundColor: c.mist, borderColor: c.mist },
  resume: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 16, borderRadius: radius.card, backgroundColor: c.accent },
  resumeDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: c.accentInk },
  resumeTitle: { fontFamily: f.medium, fontSize: 15, color: c.accentInk },
  resumeBody: { fontFamily: f.book, fontSize: 13, color: c.accentInk, opacity: 0.75, marginTop: 2 },
  note: { fontFamily: f.book, fontSize: 13, lineHeight: 18, color: c.slate700 },
});
