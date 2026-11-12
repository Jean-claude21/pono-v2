import { useApi } from '@/lib/api';
import * as m from '@/paraglide/messages.js';

/** Shown in place of the workshop when no session answers. */
export function SignIn() {
  const providers = useApi<{ providers: string[] }>('/auth/providers');
  const list = providers.result?.ok ? providers.result.data.providers : [];
  // Back to an agent's authorization once signed in (D-019).
  const next =
    typeof window === 'undefined' ? null : new URLSearchParams(window.location.search).get('next');
  const after = next?.startsWith('/oauth/authorize?') ? `next=${encodeURIComponent(next)}` : '';
  return (
    <div className="auth">
      <div className="auth-box">
        <a className="monogram" href="/">
          <b>P</b>Pono
        </a>
        <h1 style={{ fontSize: 30, lineHeight: '38px', fontWeight: 600, marginTop: 32 }}>
          {m.signin_title()}
        </h1>
        <p className="soft mt-sm">{m.signin_body()}</p>
        <p className="mute small mt-sm">{m.signin_why_github()}</p>
        <div className="stack mt-lg">
          {list.includes('github') && (
            <a className="btn btn-primary" href={`/auth/sign-in/github${after ? `?${after}` : ''}`}>
              {m.signin_github()}
            </a>
          )}
          {list.includes('github') && (
            <a className="small" href="https://github.com/signup" target="_blank" rel="noreferrer">
              {m.signin_no_github()}
            </a>
          )}
          {list.includes('dev') && (
            <a
              className="btn btn-ghost"
              href={`/auth/sign-in/dev?login=dev${after ? `&${after}` : ''}`}
            >
              {m.signin_dev()}
            </a>
          )}
          {providers.result && list.length === 0 && <p className="notice">{m.signin_none()}</p>}
        </div>
      </div>
    </div>
  );
}
