import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { setSession, trpc, type StoredPrincipal } from '../lib/trpc';
import { BrandMark, Button } from '../components/ui';

const REASSURANCE = [
  'Your own private workspace',
  'UK-first appraisal engine',
  'No card required',
];

export default function Register() {
  const navigate = useNavigate();
  const [form, setForm] = useState({ orgName: '', name: '', email: '', password: '', confirm: '' });
  const [errors, setErrors] = useState<Partial<Record<keyof typeof form, string>>>({});
  const [serverError, setServerError] = useState('');
  const register = trpc.org.register.useMutation({
    onSuccess: (res) => {
      setSession(res.token, res.principal as StoredPrincipal);
      navigate('/', { replace: true });
    },
    onError: (e) => setServerError(e.message),
  });

  const set = (key: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm((f) => ({ ...f, [key]: e.target.value }));

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setServerError('');
    const next: typeof errors = {};
    if (form.orgName.trim().length < 2) next.orgName = 'Give your organisation a name (at least 2 characters).';
    if (form.name.trim().length < 2) next.name = 'Enter your full name.';
    if (!/\S+@\S+\.\S+/.test(form.email.trim())) next.email = 'Enter a valid email address.';
    if (form.password.length < 8) next.password = 'Password must be at least 8 characters.';
    if (form.confirm !== form.password) next.confirm = 'Passwords don’t match.';
    setErrors(next);
    if (Object.keys(next).length) return;
    register.mutate({
      orgName: form.orgName.trim(),
      name: form.name.trim(),
      email: form.email.trim(),
      password: form.password,
    });
  };

  const field = (
    label: string,
    key: keyof typeof form,
    props: { type?: string; helper?: string; autoFocus?: boolean; autoComplete?: string } = {},
  ) => (
    <div className="mb-3">
      <label htmlFor={`reg-${key}`} className="label-mono text-ink-3 block mb-1">{label}</label>
      <input
        id={`reg-${key}`}
        className="w-full"
        type={props.type ?? 'text'}
        value={form[key]}
        onChange={set(key)}
        autoFocus={props.autoFocus}
        autoComplete={props.autoComplete}
      />
      {props.helper && !errors[key] && <div className="mt-1 text-[11.5px] text-ink-3">{props.helper}</div>}
      {errors[key] && <div className="mt-1 text-[12px] text-status-red">{errors[key]}</div>}
    </div>
  );

  return (
    <div
      className="min-h-screen flex items-center justify-center py-10"
      style={{ background: 'linear-gradient(160deg,#13402F 0%,#0F3528 55%,#0C2A20 100%)' }}
    >
      <div className="w-[420px] max-w-[92vw]">
        <div className="flex items-center gap-3 justify-center mb-7">
          <BrandMark size={36} />
          <span className="text-[22px] font-bold text-white tracking-[-0.5px]">
            Apex <span className="text-accent-300">Appraise</span>
          </span>
        </div>
        <form className="bg-surface rounded-panel shadow-dark-card p-5 sm:p-6" onSubmit={submit} noValidate>
          <div className="eyebrow mb-1">Create workspace</div>
          <h1 className="text-[19px] font-bold tracking-[-0.4px] mb-4">Start your organisation</h1>
          {field('Organisation name', 'orgName', { autoFocus: true, autoComplete: 'organization' })}
          {field('Your name', 'name', { autoComplete: 'name' })}
          {field('Email', 'email', { type: 'email', autoComplete: 'email' })}
          {field('Password', 'password', { type: 'password', helper: 'At least 8 characters.', autoComplete: 'new-password' })}
          {field('Confirm password', 'confirm', { type: 'password', autoComplete: 'new-password' })}
          {serverError && <div className="text-[12px] text-status-red mb-3">{serverError}</div>}
          <Button type="submit" className="w-full" loading={register.isPending}>
            Create workspace
          </Button>
          <div className="mt-3 text-center text-[12px] text-ink-2">
            Already have an account?{' '}
            <a href="/login" className="font-semibold text-brand-500 hover:text-brand-700">
              Sign in →
            </a>
          </div>
        </form>
        <ul className="mt-5 flex flex-col gap-1.5">
          {REASSURANCE.map((line) => (
            <li key={line} className="flex items-center gap-2 justify-center text-[12px] text-accent-muted-3">
              <span className="inline-block w-1.5 h-1.5 rounded-full bg-accent-bright shrink-0" aria-hidden="true" />
              {line}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
