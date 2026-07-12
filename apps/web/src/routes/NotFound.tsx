import { Link } from 'react-router-dom';
import { getPrincipal } from '../lib/trpc';
import { BrandMark, Button } from '../components/ui';

export default function NotFound() {
  const signedIn = Boolean(getPrincipal());
  return (
    <div className="min-h-screen flex items-center justify-center px-6">
      <div className="text-center max-w-[420px]">
        <div className="flex justify-center"><BrandMark size={44} /></div>
        <div className="fig mt-6 text-[64px] font-semibold tracking-[-3px] leading-none text-brand-700">404</div>
        <h1 className="mt-3 text-[22px] font-bold tracking-[-0.6px]">This page isn&rsquo;t in the workfile</h1>
        <p className="mt-2 text-[13.5px] text-ink-2 leading-relaxed">
          The link may be old, or the deal it pointed at has moved. Everything you own is still on the
          pipeline board.
        </p>
        <div className="mt-6 flex items-center justify-center gap-2.5">
          {signedIn ? (
            <>
              <Button to="/">Back to home</Button>
              <Button to="/board" variant="secondary">Pipeline board</Button>
            </>
          ) : (
            <>
              <Button to="/welcome">Apex Appraise home</Button>
              <Button to="/login" variant="secondary">Sign in</Button>
            </>
          )}
        </div>
        <div className="mt-8">
          <Link to="/welcome" className="font-mono text-[11px] tracking-[1px] uppercase text-ink-3 hover:text-ink">
            apexappraise.co.uk
          </Link>
        </div>
      </div>
    </div>
  );
}
