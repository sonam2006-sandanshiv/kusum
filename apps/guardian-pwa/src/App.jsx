import React, { useCallback, useEffect, useRef, useState } from 'react';
import { api } from './api.js';
import { playWhep } from './player.js';

const tokenFor = async (path) => (await api(`/media/token?path=${encodeURIComponent(path)}`)).token;

function LiveVideo({ path }) {
  const vRef = useRef(null);
  const [err, setErr] = useState('');
  const [pc, setPc] = useState(null);
  const connect = useCallback(() => {
    if (pc) pc.close();
    setErr('');
    playWhep(vRef.current, path, tokenFor).then(setPc).catch((e) => setErr(e.message));
  }, [path]); // eslint-disable-line
  useEffect(() => { connect(); return () => pc && pc.close(); }, [connect]); // eslint-disable-line
  return (
    <div className="video-wrap">
      <video ref={vRef} autoPlay muted playsInline />
      {err && <div className="video-err">{err}<br /><button onClick={connect}>Retry</button></div>}
    </div>
  );
}

function Auth({ onLogin }) {
  const [mode, setMode] = useState('login');
  const [f, setF] = useState({ name: '', email: '', phone: '', pass: '' });
  const [err, setErr] = useState('');
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const submit = async (e) => {
    e.preventDefault();
    try {
      const r = mode === 'login'
        ? await api('/auth/login', { method: 'POST', body: { email: f.email, pass: f.pass } })
        : await api('/auth/register', { method: 'POST', body: f });
      if (r.role !== 'guardian') return setErr('Use the hospital dashboard for staff sign-in.');
      localStorage.setItem('token', r.token);
      onLogin(r);
    } catch (ex) { setErr(ex.message); }
  };
  return (
    <div className="wrap">
      <div className="card">
        <h1>Kusum <small>Guardian</small></h1>
        <p className="hint">Watch your family member in the hospital — privately and securely.</p>
        <div className="row tabs">
          <button className={mode === 'login' ? 'active' : ''} onClick={() => setMode('login')}>Sign in</button>
          <button className={mode === 'register' ? 'active' : ''} onClick={() => setMode('register')}>Create account</button>
        </div>
        <form onSubmit={submit} className="col">
          {mode === 'register' && <>
            <input required placeholder="your full name" value={f.name} onChange={set('name')} />
            <input required placeholder="phone number" value={f.phone} onChange={set('phone')} />
          </>}
          <input required type="email" placeholder="email" value={f.email} onChange={set('email')} />
          <input required type="password" placeholder="password" value={f.pass} onChange={set('pass')} />
          {err && <p className="err">{err}</p>}
          <button>{mode === 'login' ? 'Sign in' : 'Create account'}</button>
        </form>
      </div>
    </div>
  );
}

function Onboard({ onDone }) {
  const [step, setStep] = useState(0);
  const [f, setF] = useState({ linking_code: '', patient_name: '', guardian_name: '', guardian_phone: '' });
  const [err, setErr] = useState('');
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const next = (e) => {
    e.preventDefault();
    if (step === 0 && (!f.linking_code || !f.patient_name)) return setErr('Enter both fields.');
    if (step === 1 && (!f.guardian_name || !f.guardian_phone)) return setErr('Enter both fields.');
    setErr('');
    setStep(step + 1);
  };
  const submit = async () => {
    try {
      await api('/onboard', { method: 'POST', body: f });
      onDone();
    } catch (ex) {
      setErr(ex.data?.failed?.length ? `Fields that did not match: ${ex.data.failed.join(', ')}` : ex.message);
      setStep(0);
    }
  };
  return (
    <div className="wrap">
      <div className="card">
        <h2>Verify your identity</h2>
        <p className="hint">Step {step + 1} of 3 — details must match what the hospital registered.</p>
        {step === 0 && (
          <form onSubmit={next} className="col">
            <input required placeholder="linking code from hospital (e.g. KSM-DEMO01)" value={f.linking_code} onChange={set('linking_code')} />
            <input required placeholder="patient's full name" value={f.patient_name} onChange={set('patient_name')} />
            <button>Next</button>
          </form>
        )}
        {step === 1 && (
          <form onSubmit={next} className="col">
            <input required placeholder="your full name (as registered)" value={f.guardian_name} onChange={set('guardian_name')} />
            <input required placeholder="your phone number (as registered)" value={f.guardian_phone} onChange={set('guardian_phone')} />
            <button>Next</button>
          </form>
        )}
        {step === 2 && (
          <div className="col">
            <p>Everything looks ready. Submitting sends an access request to the hospital staff, who will verify it and assign your view.</p>
            <button onClick={submit}>Submit access request</button>
            <button className="ghost" onClick={() => setStep(0)}>Back</button>
          </div>
        )}
        {err && <p className="err">{err}</p>}
      </div>
    </div>
  );
}

function Status({ onOnboard, refresh }) {
  const [reqs, setReqs] = useState([]);
  useEffect(() => { api('/me/requests').then((d) => setReqs(d.requests)); }, [refresh]);
  const latest = reqs[0];
  return (
    <div className="wrap">
      <div className="card">
        <h2>Your access status</h2>
        {latest ? (
          <>
            <p>Patient: <b>{latest.patient_name}</b> (bed {latest.bed_code})</p>
            <p>Status: <b className={latest.status}>{latest.status.toUpperCase()}</b>
              {latest.status === 'pending' && ' — waiting for hospital staff to verify and approve.'}
              {latest.status === 'rejected' && ' — the hospital declined this request. Please contact the ward.'}
            </p>
          </>
        ) : <p>No access request yet.</p>}
        <button onClick={onOnboard}>{latest ? 'Submit another request' : 'Start verification'}</button>
      </div>
    </div>
  );
}

function Live({ access, onLogout }) {
  return (
    <div className="wrap">
      <div className="card">
        <div className="row">
          <h2>{access.patient.name} · bed {access.patient.bed_code}</h2>
          <span className="spacer" />
          <button className="ghost" onClick={onLogout}>Logout</button>
        </div>
        <p className="hint">Live view — for your eyes only. The feed is privacy-blurred on the server before it is sent.</p>
        <LiveVideo path={access.stream} />
      </div>
    </div>
  );
}

export default function App() {
  const [user, setUser] = useState(null);
  const [access, setAccess] = useState(undefined); // undefined = loading
  const [onboarding, setOnboarding] = useState(false);
  const [refresh, setRefresh] = useState(0);

  const load = useCallback(() => {
    if (!localStorage.getItem('token')) { setUser(null); return; }
    api('/me').then((u) => {
      if (u.role !== 'guardian') { localStorage.clear(); setUser(null); return; }
      setUser(u);
      api('/me/access').then((d) => setAccess(d.access)).catch(() => setAccess(null));
    }).catch(() => {});
  }, []);
  useEffect(load, [load]);

  if (!user) return <Auth onLogin={load} />;
  if (access === undefined) return <p className="hint wrap">Loading…</p>;
  if (access) return <Live access={access} onLogout={() => { localStorage.clear(); setUser(null); setAccess(undefined); }} />;
  if (onboarding) return <Onboard onDone={() => { setOnboarding(false); setRefresh(refresh + 1); }} />;
  return <Status onOnboard={() => setOnboarding(true)} refresh={refresh} />;
}
