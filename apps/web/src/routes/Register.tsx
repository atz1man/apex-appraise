import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { setSession, trpc, type StoredPrincipal } from '../lib/trpc';
import { BrandMark, Button, FormError } from '../components/ui';
import { heroGradient } from '@apex/ui-tokens';

const REASSURANCE = ['Your own private workspace', 'UK-first appraisal engine', 'No card required'];

export default function Register() {
  const navigate = useNavigate();
  const [form, setForm] = useState({ orgName: '', name: '', email: '', password: '', confirm: '' });
  const [errors, setErrors] = useState<Partial<Record<keyof typeof form, string>>>({});
  const [serverError, setServerError] = useState('');
  const register = trpc.org.register.useMutation({
    // this screen shows the error where it happened; see App.tsx
    meta: { inlineError: true },
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
    if (register.isPending) return;
    setServerError('');
    const next: typeof errors = {};
    if (form.orgName.trim().length < 2) next.orgName = 'Give your organisation a name (at least 2 characters).';
    if (form.name.trim().length < 2) next.name = 'Enter your full name.';
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(form.email.trim())) next.email = 'Enter a valid email address.';
    if (form.password.length < 8) next.password = 'Password must be at least 8 characters.';
    if (form.confirm !== form.password) next.confirm = 'Passwords don’t match.';
    if (form.orgName.trim().length > 80) next.orgName = 'Use at most 80 characters.';
    if (form.name.trim().length > 80) next.name = 'Use at most 80 characters.';
    if (form.email.trim().length > 254) next.email = 'Use at most 254 characters.';
    if (form.password.length > 1024) next.password = 'Use at most 1,024 characters.';
    setErrors(next);
    const firstError = (['orgName', 'name', 'email', 'password', 'confirm'] as const).find((key) => next[key]);
    if (firstError) {
      document.getElementById(`reg-${firstError}`)?.focus();
      return;
    }
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
      <label htmlFor={`reg-${key}`} className="label-mono text-ink-3 block mb-1">
        {label}
      </label>
      {/*
        The error has to be ATTACHED to the field, not merely next to it. Sitting
        below the input in red, it is a message only somebody looking at that
        spot receives: a screen reader moving through the form reads "Password,
        edit text" and nothing else, on a field it has just refused.

        `aria-invalid` is what makes the field announce as invalid, and
        `aria-describedby` is what makes the sentence part of the field rather
        than a stray line further down the page. The helper text is described
        the same way when there is no error — the two never show together, so
        one id does for both.
      */}
      <input
        id={`reg-${key}`}
        className="w-full"
        type={props.type ?? 'text'}
        value={form[key]}
        onChange={set(key)}
        autoFocus={props.autoFocus}
        autoComplete={props.autoComplete}
        readOnly={register.isPending}
        required
        maxLength={key === 'email' ? 254 : key === 'password' || key === 'confirm' ? 1024 : 80}
        aria-invalid={errors[key] ? true : undefined}
        aria-describedby={errors[key] || props.helper ? `reg-${key}-note` : undefined}
      />
      {props.helper && !errors[key] && (
        <div id={`reg-${key}-note`} className="mt-1 text-[11.5px] text-ink-3">
          {props.helper}
        </div>
      )}
      {errors[key] && (
        <FormError id={`reg-${key}-note`} className="mt-1 text-[12px]">
          {errors[key]}
        </FormError>
      )}
    </div>
  );

  return (
    <div className="min-h-screen flex items-center justify-center py-10" style={{ background: heroGradient }}>
      <div className="w-[420px] max-w-[92vw]">
        <div className="flex items-center gap-3 justify-center mb-7">
          <BrandMark size={36} />
          <span className="text-[22px] font-bold text-white tracking-[-0.5px]">
            Apex <span className="text-accent-300">Appraise</span>
          </span>
        </div>
        <form
          className="bg-surface rounded-panel shadow-dark-card p-5 sm:p-6"
          onSubmit={submit}
          noValidate
          aria-busy={register.isPending}
        >
          <div className="eyebrow mb-1">Create workspace</div>
          <h1 className="text-[19px] font-bold tracking-[-0.4px] mb-2">Start your organisation</h1>
          <p className="text-[12.5px] text-ink-2 mb-4">
            Start a 14-day trial in your own workspace. Create your first deal, review the assumptions and save an
            appraisal.
          </p>
          {field('Organisation name', 'orgName', { autoFocus: true, autoComplete: 'organization' })}
          {field('Your name', 'name', { autoComplete: 'name' })}
          {field('Email', 'email', { type: 'email', autoComplete: 'email' })}
          {field('Password', 'password', {
            type: 'password',
            helper: 'At least 8 characters.',
            autoComplete: 'new-password',
          })}
          {field('Confirm password', 'confirm', { type: 'password', autoComplete: 'new-password' })}
          {serverError && <FormError className="text-[12px] mb-3">{serverError}</FormError>}
          {register.error?.data?.code === 'CONFLICT' && (
            <p className="text-[12px] mb-3">
              Already registered?{' '}
              <a href="/login" className="text-brand-ink underline">
                Sign in
              </a>{' '}
              or{' '}
              <a href="/forgot" className="text-brand-ink underline">
                reset your password
              </a>
              .
            </p>
          )}
          <Button type="submit" className="w-full" loading={register.isPending}>
            {register.isPending ? 'Creating your workspace…' : 'Create workspace'}
          </Button>
          <p className="mt-3 text-[11.5px] text-ink-3 leading-relaxed">
            Read our{' '}
            <a href="/terms" target="_blank" rel="noopener noreferrer" className="underline">
              Terms of service (new tab)
            </a>{' '}
            and{' '}
            <a href="/privacy" target="_blank" rel="noopener noreferrer" className="underline">
              Privacy notice (new tab)
            </a>{' '}
            before creating your workspace.
          </p>
          <div className="mt-3 text-center text-[12px] text-ink-2">
            Already have an account?{' '}
            <a href="/login" className="font-semibold text-brand-ink hover:text-brand-ink">
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
