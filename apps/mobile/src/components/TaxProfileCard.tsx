import { useCallback, useEffect, useState } from 'react';
import { StyleSheet, Text, TextInput, View } from 'react-native';
import { useConvex, useMutation } from 'convex/react';
import { makeFunctionReference } from 'convex/server';
import { colors as c, fonts as f, radius } from '../../theme';
import { identity } from '../api';
import { Button } from './Primitives';
import { PressableScale } from './PressableScale';

type TaxForm = 'none' | 'w9_on_file' | 'w8ben_on_file';
type Profile = { country?: string; taxForm: TaxForm; updatedAt?: number; label: string };
const mine = makeFunctionReference<'query', typeof identity, Profile>('tax:myProfile');
const update = makeFunctionReference<'mutation', typeof identity & { country: string; taxForm: TaxForm }, unknown>('tax:setProfile');
const FORMS = [ ['none', 'No form on file'], ['w9_on_file', 'W-9 on file'], ['w8ben_on_file', 'W-8BEN on file'] ] as const;

export function TaxProfileCard() {
  const convex = useConvex(), save = useMutation(update);
  const [country, setCountry] = useState(''), [taxForm, setTaxForm] = useState<TaxForm>('none');
  const [loaded, setLoaded] = useState(false), [busy, setBusy] = useState(false), [message, setMessage] = useState('');
  const load = useCallback(async () => {
    try {
      const profile = await convex.query(mine, identity);
      setCountry(profile.country ?? ''); setTaxForm(profile.taxForm); setLoaded(true); setMessage('');
    } catch { setMessage('Tax profile unavailable. Try again after the backend is updated.'); }
  }, [convex]);
  useEffect(() => { void load(); }, [load]);
  async function submit() {
    setBusy(true); setMessage('');
    try {
      await save({ ...identity, country: country.toUpperCase(), taxForm });
      setMessage('Profile saved with an audit record.');
    } catch { setMessage('Could not save. Check your country code and try again.'); }
    finally { setBusy(false); }
  }
  return <View style={s.card}>
    <Text accessibilityRole="header" style={s.title}>Tax-ready ledger</Text>
    <Text style={s.badge}>Not tax advice — demo data</Text>
    <Text style={s.body}>Attest to a form held outside Skarl. Only country and form status are stored. Do not enter tax IDs or upload forms. No tax is computed, withheld or filed.</Text>
    {loaded ? <>
      <Text style={s.label}>Country (ISO-2)</Text>
      <TextInput accessibilityLabel="Country (ISO-2)" value={country} onChangeText={value => setCountry(value.toUpperCase())} maxLength={2}
        autoCapitalize="characters" autoCorrect={false} placeholder="US" placeholderTextColor={c.slate500} style={s.input} />
      <Text style={s.label}>I attest to this form-on-file status</Text>
      <View accessibilityRole="radiogroup" style={{ gap: 6 }}>{FORMS.map(([value, title]) =>
        <PressableScale key={value} accessibilityRole="radio" accessibilityState={{ checked: taxForm === value }} onPress={() => setTaxForm(value)}
          style={[s.choice, taxForm === value && { borderColor: c.ink, backgroundColor: c.mist }]}><Text style={s.body}>{title}</Text></PressableScale>)}</View>
      <Button title="Save tax profile" disabled={busy || !/^[A-Z]{2}$/.test(country)} loading={busy} onPress={() => void submit()} />
      <Text style={s.body}>Missing forms send automatic payouts to buyer review. An attestation does not verify a form.</Text>
    </> : message ? <Button title="Retry tax profile" kind="secondary" onPress={() => void load()} /> : <Text style={s.body}>Loading tax profile…</Text>}
    {message ? <Text accessibilityRole="alert" style={s.body}>{message}</Text> : null}
  </View>;
}

const s = StyleSheet.create({
  card: { marginTop: 10, padding: 18, gap: 10, borderRadius: radius.card, backgroundColor: c.card, borderWidth: StyleSheet.hairlineWidth, borderColor: c.hairline },
  title: { fontFamily: f.medium, fontSize: 18, color: c.ink },
  badge: { fontFamily: f.medium, fontSize: 12, color: c.slate500 },
  body: { fontFamily: f.book, fontSize: 13, lineHeight: 19, color: c.slate500 },
  label: { fontFamily: f.medium, fontSize: 13, color: c.ink, marginTop: 3 },
  input: { padding: 12, borderRadius: 10, borderWidth: 1, borderColor: c.hairline, fontFamily: f.mono, fontSize: 15, color: c.ink },
  choice: { padding: 10, borderRadius: 10, borderWidth: 1, borderColor: c.hairline },
});
