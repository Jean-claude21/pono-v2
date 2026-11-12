import { useApi } from '@/lib/api';
import * as m from '@/paraglide/messages.js';

/** Shown in place of the workshop when no session answers. */
export function SignIn() {
  const providers = useApi<{ providers: string[] }>('/auth/providers');
  const list = providers.result?.ok ? providers.result.data.providers : [];
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
        <div className="stack mt-lg">
          {list.includes('github') && (
            <a className="btn btn-primary" href="/auth/sign-in/github">
              {m.signin_github()}
            </a>
          )}
          {list.includes('dev') && (
            <a className="btn btn-ghost" href="/auth/sign-in/dev?login=dev">
              {m.signin_dev()}
            </a>
          )}
          {providers.result && list.length === 0 && <p className="notice">{m.signin_none()}</p>}
        </div>
      </div>
    </div>
  );
}
