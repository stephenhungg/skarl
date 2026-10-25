import { StyleSheet, Text, View } from 'react-native';
import { colors as c, fonts as f } from '../../theme';
import { Pill } from './Primitives';

export const formatMs = (ms: number) => {
  const tenths = Math.round(ms / 100);
  return `${Math.floor(tenths / 600)}:${String(Math.floor(tenths % 600 / 10)).padStart(2, '0')}.${tenths % 10}`;
};
type Criterion = { criterionId: string; status: string; reason: string; evidence: { startMs: number; endMs: number; modality: string; claim: string }[] };

export function EvidenceTimeline({ criteria }: { criteria: Criterion[] }) {
  const duration = Math.max(1, ...criteria.flatMap(criterion => criterion.evidence.map(e => e.endMs)));
  return <View style={{ gap: 16 }}>
    <View style={s.timeline}>
      {['video', 'audio'].map(lane => <View key={lane} style={s.lane}>
        <Text style={s.laneLabel}>{lane.toUpperCase()}</Text><View style={s.track}>
          {criteria.flatMap((criterion, ci) => criterion.evidence.filter(e => e.modality === lane).map((e, ei) => <View key={`${ci}-${ei}`}
            style={[s.range, { left: `${e.startMs / duration * 100}%`, width: `${Math.max(1, (e.endMs - e.startMs) / duration * 100)}%`,
              backgroundColor: criterion.status === 'supported' ? c.positive : c.fog }]} />))}
        </View>
      </View>)}
      <View style={s.axis}><Text style={s.data}>0:00</Text><Text style={s.data}>{formatMs(duration)}</Text></View>
    </View>
    {criteria.map(criterion => <View key={criterion.criterionId} style={s.criterion}>
      <View style={s.heading}>
        <Text style={s.title}>{criterion.criterionId.replace(/-/g, ' ').replace(/^./, x => x.toUpperCase())}</Text>
        <Pill tone={criterion.status === 'supported' ? 'positive' : criterion.status === 'contradicted' ? 'danger' : 'muted'}>
          {criterion.status.replace(/^./, x => x.toUpperCase())}
        </Pill>
      </View>
      <Text style={s.body}>{criterion.reason}</Text>
      {criterion.evidence.map((e, index) => <View key={index} style={s.evidence}>
        <Text style={s.data}>{formatMs(e.startMs)} to {formatMs(e.endMs)} · {e.modality.toUpperCase()}</Text>
        <Text style={s.body}>{e.claim}</Text>
      </View>)}
    </View>)}
  </View>;
}
const s = StyleSheet.create({
  timeline: { gap: 10, padding: 14, backgroundColor: c.mist, borderRadius: 14 },
  lane: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  laneLabel: { width: 42, fontFamily: f.mono, fontSize: 10, color: c.slate500 },
  track: { flex: 1, height: 14, backgroundColor: c.card, borderRadius: 7, overflow: 'hidden' },
  range: { position: 'absolute', height: 14, borderRadius: 7 },
  axis: { flexDirection: 'row', justifyContent: 'space-between', paddingLeft: 50 },
  data: { fontFamily: f.mono, fontSize: 11, color: c.slate500, lineHeight: 16 },
  body: { fontFamily: f.book, fontSize: 14, lineHeight: 20, color: c.slate500 },
  criterion: { gap: 8 }, heading: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  title: { flex: 1, fontFamily: f.regular, fontSize: 16, color: c.ink },
  evidence: { paddingLeft: 12, borderLeftWidth: 2, borderLeftColor: c.haze, gap: 4 },
});
