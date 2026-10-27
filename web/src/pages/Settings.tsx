import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import type { Session } from '@supabase/supabase-js';
import ForwardingSetup from '../components/ForwardingSetup';
import PageHeader from '../components/PageHeader';
import { loadKeys } from '../lib/keys';

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="bg-white rounded-2xl border border-line p-4">
      <h3 className="font-display text-lg font-semibold mb-3">{title}</h3>
      {children}
    </section>
  );
}

export default function Settings({ session }: { session: Session }) {
  const [profile, setProfile] = useState<any>(null);
  const [categories, setCategories] = useState<any[]>([]);
  const [newCat, setNewCat] = useState('');
  const [inviteCode, setInviteCode] = useState<string | null>(null);
  const [inviteBusy, setInviteBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [showWords, setShowWords] = useState(false);

  useEffect(() => {
    async function load() {
      const [{ data: p }, { data: c }] = await Promise.all([
        supabase.from('profiles').select('*').single(),
        supabase.from('categories').select('*').order('name')
      ]);
      setProfile(p);
      setCategories(c || []);
    }
    load();
  }, []);

  async function addCategory(e: React.FormEvent) {
    e.preventDefault();
    if (!newCat.trim()) return;
    const { data } = await supabase.from('categories').insert({ user_id: session.user.id, name: newCat.trim() }).select().single();
    if (data) {
      setCategories(prev => [...prev, data].sort((a, b) => a.name.localeCompare(b.name)));
      setNewCat('');
    }
  }

  async function renameCategory(id: string, name: string) {
    await supabase.from('categories').update({ name }).eq('id', id);
    setCategories(prev => prev.map(c => c.id === id ? { ...c, name } : c));
  }

  async function archiveCategory(id: string, archived: boolean) {
    await supabase.from('categories').update({ archived }).eq('id', id);
    setCategories(prev => prev.map(c => c.id === id ? { ...c, archived } : c));
  }

  async function generateInvite() {
    setInviteBusy(true);
    setCopied(false);
    const { data, error } = await supabase.rpc('generate_invite_code');
    setInviteBusy(false);
    if (data) setInviteCode(data);
    else if (error) alert(error.message);
  }

  function copyInvite() {
    if (!inviteCode) return;
    navigator.clipboard.writeText(inviteCode);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <div>
      <PageHeader title="Settings" />

      <main className="max-w-xl mx-auto px-4 py-4 space-y-4">
        {!profile ? (
          <p className="text-center text-faint py-10">Loading…</p>
        ) : (
          <>
            <ForwardingSetup
              session={session}
              address={profile.forward_address}
              onAddressAssigned={(a) => setProfile({ ...profile, forward_address: a })}
            />

            <Card title="Categories">
              <div className="space-y-2 mb-3">
                {categories.map(c => (
                  <div key={c.id} className={`flex items-center gap-2 ${c.archived ? 'opacity-45' : ''}`}>
                    <input
                      type="text"
                      value={c.name}
                      onChange={e => renameCategory(c.id, e.target.value)}
                      className="flex-1 min-w-0 border border-line rounded-xl px-3 py-2 bg-paper outline-none focus:border-brand text-sm"
                    />
                    <button onClick={() => archiveCategory(c.id, !c.archived)}
                      className="text-xs px-3 py-2 rounded-xl border border-line font-medium text-faint bg-white active:bg-paper shrink-0">
                      {c.archived ? 'Restore' : 'Archive'}
                    </button>
                  </div>
                ))}
              </div>
              <form onSubmit={addCategory} className="flex gap-2">
                <input
                  type="text"
                  value={newCat}
                  onChange={e => setNewCat(e.target.value)}
                  placeholder="New category"
                  className="flex-1 min-w-0 border border-line rounded-xl px-3 py-2 outline-none focus:border-brand text-sm"
                />
                <button type="submit" className="bg-ink text-white px-4 py-2 rounded-xl text-sm font-semibold shrink-0">Add</button>
              </form>
            </Card>

            <Card title="Privacy & recovery">
              <p className="text-sm text-faint mb-4">
                Everything sensitive — merchants, amounts, card numbers — is encrypted on this device with a key the server never sees. Your 12 recovery words are that key: anyone with them can read your data, and without them no one can, including whoever runs this Tally.
              </p>
              {loadKeys() && (
                <>
                  <button
                    onClick={() => setShowWords(!showWords)}
                    className="w-full border border-line bg-white text-ink rounded-xl py-2.5 font-semibold active:bg-paper mb-3">
                    {showWords ? 'Hide my recovery words' : 'Show my recovery words'}
                  </button>
                  {showWords && (
                    <div className="bg-paper p-4 rounded-xl border border-line font-mono text-sm leading-relaxed select-all">
                      {loadKeys()?.phrase}
                    </div>
                  )}
                </>
              )}
            </Card>

            {profile.is_master && (
              <Card title="Invite keys">
                <p className="text-sm text-faint mb-3">You run this Tally. Generate a key and text it to whoever's joining — it works once.</p>
                {inviteCode && (
                  <div className="flex items-center gap-2 mb-2">
                    <code className="bg-paper px-3 py-2.5 rounded-xl font-mono text-lg flex-1 text-center tracking-[0.3em] font-bold select-all">{inviteCode}</code>
                    <button onClick={copyInvite}
                      className={`px-4 py-2.5 rounded-xl font-semibold transition-colors ${copied ? 'bg-under text-white' : 'bg-brand text-white'}`}>
                      {copied ? '✓ Copied' : 'Copy'}
                    </button>
                  </div>
                )}
                <button onClick={generateInvite} disabled={inviteBusy}
                  className="w-full border border-brand/40 bg-brand/5 text-brand rounded-xl py-2.5 font-semibold disabled:opacity-50">
                  {inviteBusy ? 'Generating…' : inviteCode ? 'Generate another key' : 'Generate invite key'}
                </button>
              </Card>
            )}

            <div className="pt-2 pb-6">
              <button onClick={() => supabase.auth.signOut()} className="w-full rounded-2xl border border-over/25 text-over py-3 font-semibold active:bg-over/5">
                Sign out
              </button>
              <p className="text-center text-xs text-faint mt-3">{profile.email}</p>
            </div>
          </>
        )}
      </main>
    </div>
  );
}
